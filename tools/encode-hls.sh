#!/usr/bin/env bash
# Optional per-title HLS encoder for Marmalade Player.
# Requires ffmpeg and ffprobe. Host resulting directory on a CORS-enabled HTTPS CDN.
set -euo pipefail
if [[ $# -lt 2 ]]; then
  echo 'Usage: bash tools/encode-hls.sh "movie.mp4" "output-directory"' >&2
  exit 2
fi
command -v ffmpeg >/dev/null || { echo 'Install FFmpeg first.' >&2; exit 1; }
command -v ffprobe >/dev/null || { echo 'Install FFprobe first.' >&2; exit 1; }
input=$1
out=$2
[[ -f "$input" ]] || { echo "File not found: $input" >&2; exit 1; }
mkdir -p "$out"
height=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$input" | head -1)
[[ "$height" =~ ^[0-9]+$ ]] || { echo 'No valid video stream found.' >&2; exit 1; }
audio=$(ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "$input" | head -1)
qualities=(144 240 360 480 540 720 1080)
rates=(170000 320000 560000 850000 1150000 1900000 3600000)
filters='[0:v]fps=24,split='
selected=()
for i in "${!qualities[@]}"; do
  if (( qualities[i] <= height )) || (( i == 0 )); then selected+=("$i"); fi
done
filters+="${#selected[@]}"
for j in "${!selected[@]}"; do filters+="[v${j}]"; done
filters+=';'
args=()
streams=()
for j in "${!selected[@]}"; do
  i=${selected[j]}
  h=${qualities[i]}
  b=${rates[i]}
  filters+="[v${j}]scale=w=-2:h='min(ih,${h})':flags=lanczos,format=yuv420p[o${j}];"
  args+=( -map "[o${j}]" )
  if [[ -n "$audio" ]]; then args+=( -map '0:a:0' ); streams+=("v:${j},a:${j}"); else streams+=("v:${j}"); fi
  args+=( "-c:v:${j}" libx264 "-preset:v:${j}" medium "-crf:v:${j}" 23
          "-maxrate:v:${j}" "$b" "-bufsize:v:${j}" "$((b * 2))"
          "-g:v:${j}" 48 "-keyint_min:v:${j}" 48 "-sc_threshold:v:${j}" 0 )
  if [[ -n "$audio" ]]; then args+=( "-c:a:${j}" aac "-b:a:${j}" 96000 ); fi
  mkdir -p "$out/$j"
done
filters=${filters%;}
ffmpeg -hide_banner -y -i "$input" -filter_complex "$filters" \
  "${args[@]}" -fps_mode cfr -hls_time 4 -hls_playlist_type vod \
  -hls_segment_type fmp4 -hls_flags independent_segments \
  -hls_segment_filename "$out/%v/seg_%05d.m4s" -hls_fmp4_init_filename 'init.mp4' \
  -master_pl_name master.m3u8 -var_stream_map "${streams[*]}" "$out/%v/index.m3u8"
echo "Created $out/master.m3u8"
echo 'Upload the entire directory to an HTTPS host with CORS allowing your Marmalade Pages origin.'
