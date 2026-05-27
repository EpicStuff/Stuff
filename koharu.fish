#!/usr/bin/env fish
set KOHARU http://localhost:4000/api/v1
set LLM_MODEL vntl-llama3-8b-v2
set RESIZE_MAX 1440x2560
set RESTART_MODE headless
set MODE full
set -l flags --port 4000
set -g STARTED_OPS

# ─── ARGS ───────────────────────────────────────────────────
argparse h/help e/export-only -- $argv
or exit 1
if set -q _flag_help
	echo "Usage: koharu.fish [OPTIONS]"
	echo "  -e, --export-only    Skip pipeline, just export"
	echo "  -h, --help           Show this help"
	exit 0
end

set -q _flag_e; and set MODE export

# ─── PACKAGE CHECK ──────────────────────────────────────────
set -l missing
for spec in curl:curl jq:jq fzf:fzf zip:zip unzip:unzip trash-put:trash-cli cjxl:libjxl magick:imagemagick
	set -l parts (string split ":" $spec)
	command -q $parts[1]; or set -a missing $parts[2]
end
if test (count $missing) -gt 0
	echo "Missing packages: "(string join ", " $missing)
	echo "Install with: sudo pacman -S "(string join " " $missing)
	exit 1
end

# ─── HELPERS ────────────────────────────────────────────────
function pick_yn --argument-names prompt default
	test "$default" = yes; and set order yes no; or set order no yes
	set -l result (printf '%s\n' $order | fzf --prompt="$prompt " --height=10% --reverse)
	if test -z "$result"
		echo "Cancelled" >&2
		exit 1
	end
	echo $result
end

function koharu_is_up
	curl -sf $KOHARU/meta > /dev/null 2>&1
end

function ensure_koharu_up --argument-names mode
	koharu_is_up; and return 0
	test "$mode" != gui; and set -a flags --headless
	echo "Launching koharu ($mode)..."
	prime-run koharu $flags &>/dev/null &
	disown
	set -l tries 0
	while not koharu_is_up
		sleep 1
		set tries (math $tries + 1)
		if test $tries -gt 30
			echo "Koharu failed to start within 30s — aborting." >&2
			return 1
		end
	end
	echo "Koharu is up."
end

function open_project --argument-names project_id
	curl -sX PUT $KOHARU/projects/current \
		-H 'content-type: application/json' \
		-d "{\"id\":\"$project_id\"}" > /dev/null
	sleep 1
end

function run_pipeline --argument-names pages_json steps_json
	set -l op_id (curl -sX POST $KOHARU/pipelines \
		-H 'content-type: application/json' \
		-d "{\"steps\":$steps_json,\"pages\":$pages_json}" \
		| jq -r '.operationId')
	set -ga STARTED_OPS $op_id
end

# function wait_for_pipelines
# 	set -l spin ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
# 	set -l i 1
# 	while true
# 		set -l running (curl -s $KOHARU/operations \
# 			| jq '[.operations[] | select(.status=="running" or .status=="pending" or .status=="queued")] | length')
# 		if test $running -eq 0
# 			printf "\r\e[K"
# 			break
# 		end
# 		printf "\r%s %d op(s) running..." $spin[$i] $running
# 		set i (math "$i % 10 + 1")
# 		sleep 0.3
# 	end
# end
function wait_for_pipelines
	set -l ours_json (printf '%s\n' $STARTED_OPS | jq -R . | jq -s .)
	while true
		set -l running (curl -s $KOHARU/operations \
			| jq --argjson ours "$ours_json" \
				'[.operations[] | select(.id as $id | $ours | index($id)) | select(.status=="running" or .status=="pending" or .status=="queued")] | length')
		test $running -eq 0; and break
		sleep 1
	end
end

function watch_pipeline --argument-names label
	curl -sN -H 'Accept: text/event-stream' $KOHARU/events | while read -l line
		string match -q 'data: *' -- $line; or continue
		set -l data (string sub -s 7 -- $line)

		set -l f (echo $data \
			| jq -r '[.event, .jobId // .id // "", .overallPercent // 0, .currentPage // 0, .totalPages // 0, .step // ""] | @tsv' \
			| string split \t)
		contains -- $f[2] $STARTED_OPS; or continue

		switch $f[1]
			case jobProgress
				set -l blocks (string repeat -n (math --scale=0 "$f[3] * 30 / 100") █)
				set -l bar    (string pad -r -w 30 -c · "$blocks")
				printf "\r%s [%s] %3d%% page %d/%d %s\e[K" $label $bar $f[3] $f[4] $f[5] $f[6]
			case jobFinished
				printf "\r\e[K"
				break
		end
	end
	echo "$label done."
end

function on_sigint --on-signal SIGINT
	echo
	echo "Interrupted."
	exit 130
end
function cleanup --on-event fish_exit
	if test -n "$STARTED_OPS"; and koharu_is_up
		set -l live (curl -s $KOHARU/operations \
			| jq -r '.operations[] | select(.status=="running" or .status=="pending" or .status=="queued") | .id')
		for op in $STARTED_OPS
			if contains $op $live
				echo "Cancelling op $op"
				curl -sX DELETE $KOHARU/operations/$op > /dev/null
			end
		end
	end
	if test "$RESTART_MODE" = headless
		echo "Shutting down headless koharu."
		pkill -INT koharu; sleep 1; pkill koharu
	end
end

# ─── INIT KOHARU + REMEMBER ORIGINAL STATE ─────────────────
koharu_is_up; and set RESTART_MODE gui
ensure_koharu_up headless; or exit 1

# ─── PICK PROJECT ──────────────────────────────────────────
set CHOICE (curl -s $KOHARU/projects \
	| jq -r '.projects | sort_by(-.updatedAtMs) | .[] | "\(.id)\t\(.name)"' \
	| fzf --with-nth=2 --delimiter='\t' --prompt="Project> " --height=40% --reverse)
test -z "$CHOICE"; and echo "Cancelled"; and exit 1
set PROJECT_ID   (echo $CHOICE | cut -f1)
set PROJECT_NAME (echo $CHOICE | cut -f2)
echo "Selected: $PROJECT_NAME ($PROJECT_ID)"

# ─── EXPORT / CONVERT PROMPTS ──────────────────────────────
set DO_EXPORT no
set DO_RESIZE no
set DO_CONVERT no
switch $MODE
	case full
		set DO_EXPORT (pick_yn "Export when done?" yes)
	case export
		set DO_EXPORT yes
end
if test "$DO_EXPORT" = yes
	set DO_RESIZE (pick_yn "Resize to max $RESIZE_MAX?" yes)
	set DO_CONVERT (pick_yn "Convert to JXL?" yes)
end

open_project $PROJECT_ID
set PAGES_JSON (curl -s $KOHARU/scene.json | jq -c '.scene.pages | keys')
set PAGE_COUNT (echo $PAGES_JSON | jq 'length')
echo "Pages: $PAGE_COUNT"
if test $PAGE_COUNT -eq 0
	echo "No pages — nothing to do."; exit 1
end
echo

# ─── PIPELINE PHASES (full mode only) ──────────────────────
if test $MODE = full
	# ─── PHASE 1: VISION ───────────────────────────────────
	echo "── Phase 1: vision ──"
	curl -sX DELETE $KOHARU/llm/current > /dev/null
	run_pipeline $PAGES_JSON '[
		"comic-text-bubble-detector",
		"yuzumarker-font-detection",
		"comic-text-detector-seg",
		"speech-bubble-segmentation",
		"paddle-ocr-vl-1.5",
		"lama-manga"
	]'
	watch_pipeline "Phase 1"

	# ─── PHASE 2: RESTART + LOAD LLM ───────────────────────
	echo "── Restarting koharu to free GPU VRAM ──"
	pkill -INT koharu; sleep 1; pkill koharu; sleep 2
	ensure_koharu_up $RESTART_MODE; or exit 1
	open_project $PROJECT_ID

	echo "── Phase 2: load LLM ──"
	curl -sX PUT $KOHARU/llm/current \
		-H 'content-type: application/json' \
		-d "{\"target\":{\"kind\":\"local\",\"modelId\":\"$LLM_MODEL\",\"providerId\":null}}" > /dev/null

	echo "  LLM loading..."
	set -l tries 0
	while true
		set -l llm_state  (curl -s $KOHARU/llm/current)
		set -l llm_status (echo $llm_state | jq -r '.status')
		set -l llm_err    (echo $llm_state | jq -r '.error // empty')

		if test -n "$llm_err"
			echo "LLM load failed: $llm_err" >&2
			exit 1
		end

		switch $llm_status
			case loading
				# still loading, keep polling
			case empty
				echo "LLM returned to empty state — aborting." >&2
				exit 1
			case '*'
				echo "LLM ready ($llm_status)."
				break
		end

		sleep 1
		set tries (math $tries + 1)
		if test $tries -gt 60
			echo "LLM load timed out after 5 min." >&2
			exit 1
		end
	end

	# ─── PHASE 3: TRANSLATE + RENDER ───────────────────────
	echo "── Phase 3: translate + render ──"
	run_pipeline $PAGES_JSON '["llm","koharu-renderer"]'
	watch_pipeline "Phase 3"

	echo "Done."
end

# ─── EXPORT ────────────────────────────────────────────────
if test "$DO_EXPORT" = yes
	set tmp /tmp/koharu-export.bin
	set out "$PROJECT_ID.cbz"
	set ctype (curl -sX POST $KOHARU/projects/current/export \
		-H 'content-type: application/json' \
		-d '{"format":"rendered"}' \
		-o $tmp -w "%{content_type}")

	if test -e $out
		echo "⚠ $out exists — moving to trash."
		trash-put $out
	end

	set stage (mktemp -d)
	switch $ctype
		case 'application/zip*'
			unzip -q -j $tmp -d $stage
			rm $tmp
		case 'image/png*'
			mv $tmp $stage/page-001.png
		case '*'
			echo "Unexpected content-type: $ctype"; rm -rf $stage; exit 1
	end

	if test "$DO_RESIZE" = yes
		set pngs $stage/*.png
		set total (count $pngs)
		for i in (seq $total)
			set png $pngs[$i]
			set filled (math --scale=0 "$i * 30 / $total")
			set blocks (string repeat -n $filled █)
			set bar    (string pad -r -w 30 -c · "$blocks")
			printf "\rResize [%s] %d/%d" $bar $i $total
			magick $png -resize "$RESIZE_MAX>" $png &>/dev/null
		end
		printf "\r\e[K"
		echo "Resize done."
	end

	if test "$DO_CONVERT" = yes
		set pngs $stage/*.png
		set total (count $pngs)
		for i in (seq $total)
			set png $pngs[$i]
			set filled (math --scale=0 "$i * 30 / $total")
			set blocks (string repeat -n $filled █)
			set bar    (string pad -r -w 30 -c · "$blocks")
			printf "\rJXL [%s] %d/%d" $bar $i $total
			cjxl -q 100 -e 7 $png (string replace -r '\.png$' '.jxl' $png) &>/dev/null
			rm $png
		end
		printf "\r\e[K"
		echo "JXL conversion done."
	end

	zip -j -q $out $stage/*
	rm -rf $stage
	echo "Saved: "(pwd)/$out
end