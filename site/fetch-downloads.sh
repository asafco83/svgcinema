#!/bin/sh
# SVGcinema — the site's downloads that aren't in the repository
# The thumbnail installers (built by .github/workflows/thumbnailers.yml) live in the rolling
# "thumbnails" release; the GitHub Pages build fetches them into public/downloads/ before building,
# and so must any other build of the site, or the landing page's download links break.
# Needs the GitHub CLI (gh), signed in. Usage: sh site/fetch-downloads.sh
set -e
cd "$(dirname "$0")/.."
REPO=${GITHUB_REPOSITORY:-asafco83/svgcinema}
mkdir -p public/downloads
gh api "repos/$REPO/releases/tags/thumbnails" --jq '.assets[] | "\(.id) \(.name)"' |
  while read -r id name; do
    gh api -H 'Accept: application/octet-stream' "repos/$REPO/releases/assets/$id" > "public/downloads/$name"
    echo "public/downloads/$name"
  done
