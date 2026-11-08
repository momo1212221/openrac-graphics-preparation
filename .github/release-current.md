Graphics preparation 0.10.2 adds seam-aware CNN context.

- Detects plausible horizontal/vertical repetition from opposite-edge error versus local edge gradients.
- Repeating world textures use wrapped source context at CNN boundaries instead of edge clamp.
- Sky textures get a conservative horizontal-repeat allowance.
- UI, normal and mask textures never auto-wrap.
- Both x4plus and the second detail CNN receive the same wrap-aware context.
- Persistent cache pipeline identity is bumped so old clamp-context outputs are not reused.
- Wrap diagnostics are retained in AI result/cache metadata.
