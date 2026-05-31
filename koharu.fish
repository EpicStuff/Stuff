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
function die
	echo $argv >&2
	exit 1
end

function pick_yn --argument-names prompt default
	if test "$default" = yes
		set order Yes No
	else
		set order No Yes
	end
	set -l result (printf '%s\n' $order | fzf --prompt="$prompt " --height=10% --reverse | string lower)
	test -z "$result"; and die 'Cancelled'
	echo $result
end

function koharu_is_up
	curl -sf $KOHARU/meta > /dev/null 2>&1
end

function stop_koharu
	pkill -INT koharu; sleep 1; pkill koharu
end

function ensure_koharu_up
	koharu_is_up; and return 0
	set -l flags $BASE_FLAGS
	set -l label gui
	if not set -q koharu_was_up
		set -a flags --headless
		set label headless
	end
	echo "  Launching koharu ($label)..."
	koharu $flags &> /tmp/koharu.log & disown
	set -l tries 0
	while not koharu_is_up
		sleep 1
		set tries (math $tries + 1)
		test $tries -gt 30; and die 'Koharu failed to start within 30s, aborting.'
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
	or die 'Failed to start pipeline.'
	set -ga started_ops $op_id
end

function bar --argument-names pct width
	set -l blocks (string repeat -n (math --scale=0 "$pct * $width / 100") █)
	string pad -r -w $width -c · "$blocks"
end

function format_bar --argument-names label cur total bw
	set -l pct 0
	test $total -gt 0; and set pct (math --scale=0 "$cur * 100 / $total")
	printf '%s [%s] %3d%% (%d/%d)' $label (bar $pct $bw) $pct $cur $total
end

function draw_bar --argument-names label cur total bw
	printf '\r  %s\e[K\n' (format_bar $label $cur $total $bw)
end

function watch_pipeline --argument-names label bars
	test -z "$bars"; and set bars 2
	set -l bw (math "$COLUMNS - 45")
	test $bw -lt 15; and set bw 15
	test $bw -gt 80; and set bw 80

	# Koharu buffers SSE writes when there's only one subscriber.
	# A second discarded reader forces it to flush per-write.
	# Killed alongside the main curl by the pkill in case jobFinished.
	curl -sN -H 'Accept: text/event-stream' $KOHARU/events > /dev/null &

	set -l first yes
	set -l finished no
	curl -sN -H 'Accept: text/event-stream' $KOHARU/events | while read -l line
		string match -q 'data: *' -- $line; or continue
		set -l data (string sub -s 7 -- $line)

		set -l f (echo $data \
			| jq -r '[.event, (if .event == "jobFinished" then .id else .jobId end), .currentPage, .totalPages, .currentStepIndex, .totalSteps, .step] | @tsv' \
			| string split \t)
		contains -- $f[2] $started_ops; or continue

		switch $f[1]
			case jobProgress
				set current_page $f[3]
				set total_pages  $f[4]
				set current_step $f[5]
				set total_steps  $f[6]
				test "$first" = no; and printf '\033[%dA' $bars
				set first no
				draw_bar page $current_page $total_pages $bw
				test $bars -ge 2; and draw_bar step $current_step $total_steps $bw
			case jobFinished
				set finished yes
				pkill -P $fish_pid curl 2>/dev/null
				break
		end
	end
	test "$finished" != yes; and die "  $label: event stream ended before jobFinished"
	if test "$first" = no
		set current_page (math "min($current_page + 1, $total_pages)")
		set current_step (math "min($current_step + 1, $total_steps)")
		printf '\033[%dA' $bars
		draw_bar page $current_page $total_pages $bw
		test $bars -ge 2; and draw_bar step $current_step $total_steps $bw
	end
	echo "  $label done."
end

function process_pngs --argument-names kind label dir
	set -l pngs $dir/*.png
	set -l total (count $pngs)
	set -l failed
	set -l first yes
	for i in (seq $total)
		set -l png $pngs[$i]
		test "$first" = no; and printf '\033[1A'
		set first no
		draw_bar $label $i $total 30
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
	if not set -q koharu_was_up
		echo 'Shutting down headless koharu.'
		stop_koharu
	end
end

# ─── INIT KOHARU + REMEMBER ORIGINAL STATE ─────────────────
koharu_is_up; and set -g koharu_was_up yes
ensure_koharu_up

# ─── PICK PROJECT ──────────────────────────────────────────
set CHOICE (curl -s $KOHARU/projects \
	| jq -r '.projects | sort_by(-.updatedAtMs) | .[] | "\(.id)\t\(.name)"' \
	| fzf --with-nth=2 --delimiter='\t' --prompt='Project> ' --height=40% --reverse)
test -z "$CHOICE"; and die 'Cancelled'
set -l parts (string split \t -- $CHOICE)
set PROJECT_ID   $parts[1]
set PROJECT_NAME $parts[2]
echo "Selected: $PROJECT_NAME ($PROJECT_ID)"

# ─── EXPORT / CONVERT PROMPTS ──────────────────────────────
set DO_EXPORT no
set DO_RESIZE no
set DO_CONVERT no
if set -q _flag_e
	set DO_EXPORT yes
else
	set DO_EXPORT (pick_yn 'Export when done?' yes)
end
if test "$DO_EXPORT" = yes
	set DO_RESIZE (pick_yn "Resize to max $RESIZE_MAX?" yes)
	set DO_CONVERT (pick_yn 'Convert to JXL?' yes)
end

open_project $PROJECT_ID
set PAGES_JSON (curl -s $KOHARU/scene.json | jq -c '.scene.pages | keys')
set PAGE_COUNT (echo $PAGES_JSON | jq 'length')
echo "Pages: $PAGE_COUNT"
test $PAGE_COUNT -eq 0; and die 'No pages — nothing to do.'

# ─── PIPELINE PHASES (full mode only) ──────────────────────
if not set -q _flag_e
	# ─── PHASE 1: VISION ───────────────────────────────────
	echo '──────────────── Phase 1: Vision ─────────────────'
	curl -sX DELETE $KOHARU/llm/current > /dev/null
	run_pipeline $PAGES_JSON $VISION_STEPS
	watch_pipeline 'Phase 1'

	# ─── PHASE 2: RESTART + LOAD LLM ───────────────────────
	echo '─────────── Phase 2: Unloading Models ────────────'
	echo '  Restarting koharu to free GPU VRAM'
	stop_koharu; sleep 2
	ensure_koharu_up
	open_project $PROJECT_ID

	curl -sX PUT $KOHARU/llm/current \
		-H 'content-type: application/json' \
		-d "{\"target\":{\"kind\":\"local\",\"modelId\":\"$LLM_MODEL\",\"providerId\":null}}" > /dev/null

	echo '  LLM loading...'
	set -l tries 0
	while true
		set -l parts (curl -s $KOHARU/llm/current \
			| jq -r '[.status, (.error // "")] | @tsv' \
			| string split \t)
		set -l llm_status $parts[1]
		set -l llm_err    $parts[2]

		test -n "$llm_err"; and die "LLM load failed: $llm_err"

		switch $llm_status
			case loading
			case empty
				die 'LLM returned to empty state — aborting.'
			case ready loaded
				echo "  LLM ready ($llm_status)."
				break
			case '*'
				die "LLM unknown status '$llm_status' — aborting."
		end

		sleep 1
		set tries (math $tries + 1)
		test $tries -gt 60; and die 'LLM load timed out after 1 min.'
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
	or die 'Export failed.'

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