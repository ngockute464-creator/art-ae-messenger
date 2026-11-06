# E9 voice messages — staging branch object
Recorded via MediaRecorder (WebM/Opus or MP4 where supported), no arbitrary duration timeout. A recording is previewed before sending, with Cancel/Send.
At send, split into 1 MiB chunks, authenticated transfer through Netlify function into a private Yandex Disk subfolder; a short voice marker is stored in the existing PostgreSQL message body. No schema migration.
Playback loads authenticated chunks from the matching conversation and produces audio controls. Transcription is a separate later phase.

Security: no direct Yandex public links, no microphone access before user action, server validates session, project, conversation and committed voice message on read. Reserved storage folder hidden/blocked from ordinary file explorer.

Limitations: long recordings are buffered in browser memory; playback fetches all chunks before audio can play, so very long messages use substantial RAM and bandwidth. Retrying after a page reload cannot recover a recording that never reached the server. Browser iOS Safari / Android MediaRecorder and hosted Netlify deployment are unverified. The 1 MiB transfer chunk is a network safety limit, NOT a maximum voice recording duration.

Before enabling for users, run real browser and hosted integration tests, including creating and playing a recording on both iOS and Android.
