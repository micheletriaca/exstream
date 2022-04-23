#!/bin/bash

set -euo pipefail

version=$(cat "package.json" |jq .version)
echo releasing "v$version"

git tag "v$version"
git push origin "v$version"
npm publish
## https://cli.github.com/manual/gh_release_create
gh release create "v$version"
