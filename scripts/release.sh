#!/bin/bash

set -euo pipefail

version=$(cat "package.json" | jq -r .version)
echo releasing "v$version..."

git tag "v$version"
git push origin "v$version"
# https://cli.github.com/manual/gh_release_create
gh release create "v$version"
npm publish
