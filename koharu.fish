#!/usr/bin/env fish
set KOHARU http://localhost:4000/api/v1
set LLM_MODEL vntl-llama3-8b-v2
set RESIZE_MAX 1440x2560
set BASE_FLAGS --port 4000
set VISION_STEPS '[
	"comic-text-bubble-detector",
	"yuzumarker-font-detection",
	"comic-text-detector-seg",
	"speech-bubble-segmentation",
	"paddle-ocr-vl-1.5",
	"lama-manga"
]'
set LLM_STEPS '["llm","koharu-renderer"]'
set mode full
set restart_mode headless
set started_ops

# ─── ARGS ───────────────────────────────────────────────────
argparse h/help e/export-only -- $argv
or exit 1
if set -q _flag_help
	echo 'Usage: koharu.fish [OPTIONS]'
	echo '  -e, --export-only    Skip pipeline, just export'
	echo '  -h, --help           Show this help'
	exit 0
end

set -q _flag_e; and set mode export

# ─── PACKAGE CHECK ──────────────────────────────────────────
set -l missing
for spec in curl:curl jq:jq fzf:fzf zip:zip unzip:unzip trash-put:trash-cli cjxl:libjxl magick:imagemagick
	set -l parts (string split ':' $spec)
	command -q $parts[1]; or set -a missing $parts[2]
end
if test (count $missing) -gt 0
	echo 'Missing packages: '(string join ', ' $missing)
	echo 'Install with: sudo pacman -S '(string join ' ' $missing)
	exit 1
end

# ─── HELPERS ────────────────────────────────────────────────
function pick_yn --argument-names prompt default
	test "$default" = yes; and set order Yes No; or set order No Yes
	set -l result (printf '%s\n' $order | fzf --prompt="$prompt " --height=10% --reverse | string lower)
	if test -z "$result"
		echo 'Cancelled' >&2
		exit 1
	end
	echo $result
end

function koharu_is_up
	curl -sf $KOHARU/meta > /dev/null 2>&1
end

function ensure_koharu_up
	koharu_is_up; and return 0
	set flags $BASE_FLAGS
	test "$restart_mode" = headless; and set -a flags --headless
	echo "  Launching koharu ($restart_mode)..."
	koharu $flags &> /tmp/koharu.log & disown
	set -l tries 0
	while not koharu_is_up
		sleep 1
		set tries (math $tries + 1)
		if test $tries -gt 30
			echo 'Koharu failed to start within 30s, aborting.' >&2
			exit 1
		end
	end
	echo '  Koharu is up.'
end

function open_project --argument-names project_id
	curl -sX PUT $KOHARU/projects/current \
		-H 'content-type: application/json' \
		-d "{\"id\":\"$project_id\"}" > /dev/null
	sleep 1
end

function run_pipeline --argument-names pages_json steps_json
	set -l op_id (
		curl -sfX POST $KOHARU/pipelines -H 'content-type: application/json' -d "{\"steps\":$steps_json,\"pages\":$pages_json}" \
		| jq -er '.operationId'
	)
	or begin
		echo 'Failed to start pipeline.' >&2
		exit 1
	end
	set -ga started_ops $op_id
end

function bar --argument-names pct width
	set -l blocks (string repeat -n (math --scale=0 "$pct * $width / 100") █)
	string pad -r -w $width -c · "$blocks"
end

function watch_pipeline --argument-names label bars
	test -z "$bars"; and set bars 2
	set -l bw (math "$COLUMNS - 45")
	test $bw -lt 15; and set bw 15
	test $bw -gt 80; and set bw 80

	set -l first yes
	set -l finished no
	curl -sN -H 'Accept: text/event-stream' $KOHARU/events | while read -l line
		string match -q 'data: *' -- $line; or continue
		set -l data (string sub -s 7 -- $line)

		set -l f (echo $data \
			| jq -r '[.event, .jobId // .id // "", .currentPage // 0, .totalPages // 0, .currentStepIndex // 0, .totalSteps // 0, .step // ""] | @tsv' \
			| string split \t)
		contains -- $f[2] $started_ops; or continue

		switch $f[1]
			case jobProgress
				set -l page_pct 0
				test $f[4] -gt 0; and set page_pct (math --scale=0 "$f[3] * 100 / $f[4]")

				test "$first" = no; and printf '\033[%dA' $bars
				set first no

				printf '\r  page [%s] %3d%% (%d/%d)\e[K\n' (bar $page_pct $bw) $page_pct $f[3] $f[4]
				if test $bars -ge 2
					set -l step_pct 0
					test $f[6] -gt 0; and set step_pct (math --scale=0 "$f[5] * 100 / $f[6]")
					printf '\r  step [%s] %3d%% (%d/%d)\e[K\n' (bar $step_pct $bw) $step_pct $f[5] $f[6]
				end
			case jobFinished
				set finished yes
				break
		end
	end
	if test "$finished" != yes
		echo "  $label: event stream ended before jobFinished" >&2
		exit 1
	end
	echo "  $label done."
end

function process_pngs --argument-names kind label dir
	set -l pngs $dir/*.png
	set -l total (count $pngs)
	set -l failed
	for i in (seq $total)
		set -l png $pngs[$i]
		set -l pct (math --scale=0 "$i * 100 / $total")
		printf '\r%s [%s] %d/%d' $label (bar $pct 30) $i $total
		set -l rc 0
		switch $kind
			case resize
				magick $png -resize "$RESIZE_MAX>" $png
				set rc $status
			case jxl
				cjxl -q 100 -e 7 $png (string replace -r '\.png$' '.jxl' $png)
				set rc $status
				test $rc -eq 0; and rm $png
		end
		test $rc -ne 0; and set -a failed $png
	end
	printf '\r\e[K'
	set -l fcount (count $failed)
	if test $fcount -gt 0
		echo "$label done ($fcount failed)."
	else
		echo "$label done."
	end
end

function on_sigint --on-signal SIGINT
	echo
	echo 'Interrupted.'
	exit 130
end
function cleanup --on-event fish_exit
	if set -q started_ops[1]; and koharu_is_up
		set -l live (curl -s $KOHARU/operations \
			| jq -r '.operations[] | select(.status=="running" or .status=="pending" or .status=="queued") | .id')
		for op in $started_ops
			if contains $op $live
				echo "Cancelling op $op"
				curl -sX DELETE $KOHARU/operations/$op > /dev/null
			end
		end
	end
	if test "$restart_mode" = headless
		echo 'Shutting down headless koharu.'
		pkill -INT koharu; sleep 1; pkill koharu
	end
end

# ─── INIT KOHARU + REMEMBER ORIGINAL STATE ─────────────────
koharu_is_up; and set restart_mode gui
ensure_koharu_up

# ─── PICK PROJECT ──────────────────────────────────────────
set CHOICE (curl -s $KOHARU/projects \
	| jq -r '.projects | sort_by(-.updatedAtMs) | .[] | "\(.id)\t\(.name)"' \
	| fzf --with-nth=2 --delimiter='\t' --prompt='Project> ' --height=40% --reverse)
test -z "$CHOICE"; and echo 'Cancelled'; and exit 1
set PROJECT_ID   (echo $CHOICE | cut -f1)
set PROJECT_NAME (echo $CHOICE | cut -f2)
echo "Selected: $PROJECT_NAME ($PROJECT_ID)"

# ─── EXPORT / CONVERT PROMPTS ──────────────────────────────
set DO_EXPORT no
set DO_RESIZE no
set DO_CONVERT no
switch $mode
	case full
		set DO_EXPORT (pick_yn 'Export when done?' yes)
	case export
		set DO_EXPORT yes
end
if test "$DO_EXPORT" = yes
	set DO_RESIZE (pick_yn "Resize to max $RESIZE_MAX?" yes)
	set DO_CONVERT (pick_yn 'Convert to JXL?' yes)
end

open_project $PROJECT_ID
set PAGES_JSON (curl -s $KOHARU/scene.json | jq -c '.scene.pages | keys')
set PAGE_COUNT (echo $PAGES_JSON | jq 'length')
echo "Pages: $PAGE_COUNT"
if test $PAGE_COUNT -eq 0
	echo 'No pages — nothing to do.'; exit 1
end

# ─── PIPELINE PHASES (full mode only) ──────────────────────
if test "$mode" = full
	# ─── PHASE 1: VISION ───────────────────────────────────
	echo '──────────────── Phase 1: Vision ─────────────────'
	curl -sX DELETE $KOHARU/llm/current > /dev/null
	run_pipeline $PAGES_JSON $VISION_STEPS
	watch_pipeline 'Phase 1'

	# ─── PHASE 2: RESTART + LOAD LLM ───────────────────────
	echo '─────────── Phase 2: Unloading Models ────────────'
	echo '  Restarting koharu to free GPU VRAM'
	pkill -INT koharu; sleep 1; pkill koharu; sleep 2
	ensure_koharu_up
	open_project $PROJECT_ID

	curl -sX PUT $KOHARU/llm/current \
		-H 'content-type: application/json' \
		-d "{\"target\":{\"kind\":\"local\",\"modelId\":\"$LLM_MODEL\",\"providerId\":null}}" > /dev/null

	echo '  LLM loading...'
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
				echo 'LLM returned to empty state — aborting.' >&2
				exit 1
			case ready loaded
				echo "  LLM ready ($llm_status)."
				break
			case '*'
				echo "LLM unknown status '$llm_status' — aborting." >&2
				exit 1
		end

		sleep 1
		set tries (math $tries + 1)
		if test $tries -gt 60
			echo 'LLM load timed out after 1 min.' >&2
			exit 1
		end
	end

	# ─── PHASE 3: TRANSLATE + RENDER ───────────────────────
	echo '────────── Phase 3: Translate + Render ───────────'
	run_pipeline $PAGES_JSON $LLM_STEPS
	watch_pipeline 'Phase 3' 1

	echo 'Done.'
end

# ─── EXPORT ────────────────────────────────────────────────
if test "$DO_EXPORT" = yes
	set tmp /tmp/koharu-export.bin
	set out "$PROJECT_ID.cbz"
	set ctype (curl -sfX POST $KOHARU/projects/current/export \
		-H 'content-type: application/json' \
		-d '{"format":"rendered"}' \
		-o $tmp -w '%{content_type}')
	or begin
		echo 'Export failed.' >&2
		exit 1
	end

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

	test "$DO_RESIZE"  = yes; and process_pngs resize Resize $stage
	test "$DO_CONVERT" = yes; and process_pngs jxl    JXL    $stage

	zip -j -q $out $stage/*
	rm -rf $stage
	echo 'Saved: '(pwd)/$out
end