# Network logos

Drop channel logos in here and the guide will use them instead of whatever the
provider serves.

Name each file after the channel, however you like - matching ignores case,
punctuation and spacing, so `BBC One.png`, `bbc-one.png` and `bbcone.webp` all
match a channel called "BBC One". PNG, WEBP, JPG and SVG are all read.

    network logos/
      bbc-one.png
      sky-sports-main-event.webp

This folder's contents are gitignored, because broadcaster logos belong to their
owners and are not ours to redistribute. Put your own files here; nothing is
bundled with A-X-M.

A channel with no file here falls back to the artwork its provider supplies, and
then to a generic icon.
