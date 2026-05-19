# Notice and Attribution

This repository is prepared as a transparent downstream copy/fork of:

- Upstream project: [Gan-Xing/CodexBridge](https://github.com/Gan-Xing/CodexBridge)
- Upstream remote kept locally as: `upstream`
- Original authorship: upstream maintainers and contributors
- Downstream maintainer contact: [MinZ-ops](https://github.com/MinZ-ops)

## License Status

At the time this downstream copy was prepared, no explicit `LICENSE` file or
package-level license field was found in the upstream repository snapshot.

That means broad reuse rights are not clearly granted by default. To reduce
plagiarism and copyright risk:

- keep upstream attribution visible in the README and repository metadata;
- preserve git commit history where possible;
- prefer GitHub's fork relationship over uploading as an unrelated new project;
- do not claim this project as original work;
- ask the upstream maintainer for an explicit license or permission before
  public redistribution, commercial use, or heavy rebranding.

This notice is not legal advice. It is an operational attribution and risk
reduction note for downstream maintenance.

## Downstream Changes

This copy currently includes local downstream maintenance changes, including:

- README and notice text that clearly identify the upstream source;
- QR login polling hardening for transient WeChat status request timeouts;
- Codex app-server transport compatibility for newer Codex CLI versions that
  default to `stdio://` instead of WebSocket listening.

Keep future downstream changes documented here or in a changelog so reviewers
can distinguish upstream work from local maintenance.
