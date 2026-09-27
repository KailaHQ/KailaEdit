# Changelog

What changed, release by release, as a user would see it.

The section for the version being released is cut out by
`scripts/release-notes.cjs` and becomes the body of the GitHub Release — which
is also the text the in-app updater shows when it offers a new version. So write
it for someone editing video, not for a developer: say what changed and what it
means for them, not which function moved.

A release with no section here is refused by CI before anything is built.

## [Unreleased]

## [1.0.8] - 2026-09-28

### Added
- **Shapes & Lines Library.** A dedicated Shapes library in the Stickers tab with customizable arrows, callouts, lines, and basic geometric shapes for video annotations and overlays.
- **System Font Picker & Favorites.** Unified font selection across Text clips, Subtitle tracks, and Cover Studio that automatically detects local system fonts alongside standard typography, featuring live search, visual font preview, and starred favorite fonts.
- **Dedicated Shape Transform Controls.** Bounding box with independent width and height scaling handles for shape clips, enabling flexible stretching, resizing, and rotation directly on the program monitor.
- **Dynamic Clip In-Point Thumbnails.** Timeline video clips now extract and display a preview thumbnail matching the clip's actual in-point (trimStart) rather than always showing the beginning of the source media file.

### Changed
- **Multi-line Inline Editing in Cover Studio.** Double-clicking cover text opens a seamless in-place textarea with live styling, automatic expansion, and keyboard shortcuts (`Ctrl+Enter` to save, `Esc` to cancel).
- **Aspect Ratio-Aware Render Cache.** Preview rendering cache now mirrors the exact aspect ratio of the active timeline (including 9:16 portrait and 1:1 square), eliminating layer misalignment and duplicate video ghosting during multi-track playback.

### Fixed
- **Keyframe end snap and final frame transform.** Dragging a keyframe towards the end of a clip now magnetically snaps cleanly to the final frame (`clip.duration`), accurately updates playhead selection, and guarantees that transforms applied at the end persist through the cut without popping back to original dimensions or flashing the untransformed frame.
- **Magnetic Track 1 trimming and overlap safety.** Trimming clips on the main magnetic track ripples downstream media and linked audio in sync without scrambling clip order, and dragging longer clips down to Track 1 will no longer accidentally delete or overwrite underlying clips.
- **Stale frame flash on cut points.** Prevented the video player pool from briefly flashing the last frame of the preceding cut with reset styling while seeking to the start of a subsequent cut from the same media.
- **Windowed timeline audio envelope and keyframe alignment.** Audio volume envelopes and keyframe markers remain strictly aligned to their visual clip boundaries during timeline trimming and scrolling.
- **Timeline cut point transition centering.** Transition indicators on the timeline now align symmetrically across the cut junction between adjacent clips.

## [1.0.7] - 2026-09-22

### Fixed
- **Synchronized playback with Remove Background.** Video playback no longer freezes the cutout mask on the initial frame while the underlying video keeps playing; the subject cutout now tracks smoothly frame-by-frame during playback.
- **Prevented un-matted frame flashes.** Seeking or scrubbing a clip with Remove Background enabled no longer flashes raw uncut video frames before the cutout is ready; the player holds the prior frame or stays transparent until synchronized.
- **Silhouette alignment when scrubbing.** Rapidly scrubbing through video with Remove Background enabled no longer leaves subject outlines drifting or trailing behind the picture.
- **Automatic cutout recovery on project open.** Reopening a project now immediately restores background removal on timeline clips, prioritizing the frame right at the playhead without having to open the Remove Background panel or seek.
- **Project-scoped background removal processing.** Switching between projects now cleanly cancels background removal jobs from the previous project, preventing unrelated jobs from running in the background.
- **Export reliability with background removal.** Exporting a project now verifies that background removal covers the entire clip duration before rendering, preventing videos from exporting with background leaks.
- **Playback speed on clips with Remove Background.** Changing a clip's speed no longer causes the video to play at double speed once background removal is processed.

## [1.0.6] - 2026-09-20

### Added
- **Custom Cover Templates.** Create and save your own cover design templates in Cover Studio.
  Save any layout as a reusable template, update existing custom templates with one click,
  or "Save as" a new template. Custom templates are saved to your local library and can be applied
  seamlessly across any video project.
- **High-Fidelity AI Background Removal.** A newly rebuilt on-device portrait cutout engine
  running directly with hardware acceleration (DirectML/CPU). Cuts out subjects in under a second
  with full hair preservation, clean soft edges, and zero spatial offset. 100% offline with zero cloud calls.

### Changed
- **Cleaner Media Library filenames.** File labels now sit neatly below thumbnails in a single line,
  with smart truncation preserving the file extension and trailing characters (e.g. `my-video-...4k.mp4`)
  so long filenames no longer clutter the media bin.
- **Streamlined Cover Studio toolbar.** Replaced the redundant Animate tab with Templates, and streamlined
  cover template operations with dedicated "Save Template", "Update Template", and "Save as Template" buttons.

### Fixed
- **Cover background removal cutting off hair and misaligning edges.** Fixed an issue where background
  removal in Cover Studio was downgraded to low resolution, cutting hair into a dome shape and leaving
  patches of wall or slicing into cheeks. Background removal now outputs at full source resolution with perfect alignment.
- **Cover template text input closing unexpectedly.** Fixed a bug where typing a template name inside
  the save modal would prematurely dismiss the dialog.
- **Cover changes not persisting on save.** Fixed an issue where applying a template to a cover and saving
  did not properly record the updated cover elements into the timeline.

## [1.0.5] - 2026-09-16

### Changed
- **The editor is now called KailaEdit.** Same program, new name — window title,
  icon, installer and all. It was KomfyEdit.
- **Your projects come with you. Your settings do not.** KailaEdit keeps its files in
  a folder of its own, and it still knows where KomfyEdit kept yours, so everything
  you have edited opens exactly as before. What does not follow the move: keyboard
  shortcuts you remapped, saved layouts and layout presets, favourite filters, and
  any templates you made yourself. Those start fresh. Nothing was deleted — your old
  templates are still sitting in the KomfyEdit folder, ready to be copied across if
  you want them.
- **KailaEdit installs beside KomfyEdit rather than replacing it.** Your computer
  treats it as a separate program, so after installing you will have both. Letting
  KomfyEdit update itself leaves you with two copies as well, so it is cleaner to
  install KailaEdit once by hand and then uninstall KomfyEdit when you are happy.
- **The AI assistant is now called CoEdit.** EditPilot became CoEdit — the side
  panel, the launcher, its settings and its messages. Anything it wrote for you
  before still works.

### Added
- **Updates without leaving the app.** KailaEdit watches for a new version in the
  background and puts a button in the window header when one is ready. You can watch
  it download and restart once to finish.
- **A better speed slider.** Changing a clip's speed feels smoother, and the timeline
  shows the clip's new length while you drag instead of after you let go.
- **Clearer keyframes.** The keyframe row and the diamond toggles are easier to read
  across the property panels, so motion, opacity and audio curves are easier to follow.

### Fixed
- **CoEdit could not start after the rename.** The helper it talks to had moved, so
  asking it to do anything failed. It works again, and a setup you configured under
  the old name keeps working.
- **CoEdit losing track of the open project mid-edit.** It could stop following the
  timeline part-way through a job; it now stays in step.

## [1.0.4] - 2026-09-13

### Added
- **Sound Effects Library.** 29 studio-quality sound effects built into the Audio
  tab, organised across 7 categories: Transitions, Accents & UI, Notifications &
  Games, Impacts & Hits, Comedy & Meme, and Foley & Ambience. Click to preview
  with instant play/pause, and click '+' to insert directly onto audio track A2
  at your playhead. You can also import and organise your own external sound effect files.
- **Animated Stickers.** 39 new animated stickers (Google Noto Emoji) with transparent
  alpha channels across reactions, celebrations, hearts, and gestures. Filter by the
  new "Animated" pill in the Stickers tab, and export with seamless looping animation
  throughout the clip duration.
- **Bilingual search & localization.** Complete Vietnamese and English translations
  for all 29 sound effects and their acoustic usage tips. The search bar now matches
  both Vietnamese and English names, descriptions, and keywords dynamically.
- **Templates.** Save the edit you are looking at — its cuts, effects, text and
  transitions — and put new footage through it on your next video. The footage
  on the main track becomes the slots you fill in later; your media is never
  stored in the template. Applying one builds a **new timeline** beside the one
  you are working in, so nothing you have done is overwritten and you can play
  both before choosing. A template also carries its own music and overlays, so
  a saved edit sounds and looks the same next time; that media is copied into
  the project when you apply it, so the project does not depend on the template
  staying where it is. Each one can carry a cover picture taken from your first
  shot, so you recognise it in the list — that is a frame of your own footage,
  so it is a tick box rather than something that just happens. Templates are
  files under your presets folder, and EditPilot can apply them too.
- Eight sample templates ship with the app, so the Templates tab is not empty on
  the first run: openers, montages, comparisons and text pieces. None of them
  carries music — what they carry is the cut rhythm, the framing moves and the
  titles. Apply one, change it, and save it as your own.
- The Templates tab is a browser rather than a list: shelves down the left side,
  a search box, filters for shape and for how many shots a template wants, and a
  two-column grid. A template with no cover picture is drawn as a diagram of
  itself — the frame in its real proportions and a block per shot — rather than
  left blank.
- Before a template is applied, the slot picker says what each clip you picked
  will actually do: play as it is, slow down to fill a slot it is short for, or
  leave the end of that slot empty. That was always decided somewhere; now it is
  decided in front of you.

### Fixed
- **Filter layer placement.** Adding a filter from the Filters library now always
  creates an independent Filter Adjustment Layer on the topmost video track rather
  than collapsing onto track V1 at the bottom or falling into the audio track.
  Clicking a filter while previewing video no longer replaces clip properties
  behind your back.
- **Timeline track dragging & layer creation.** Fixed vertical coordinate tracking
  across tracks, making it smooth and accurate to drag clips between layers. Fixed
  an issue where dragging a clip upwards to create a new track was undone by
  automatic track pruning.
- Clearing a cache freed nothing, and said it had worked. Every cache the app
  offers to empty — the draft cache, the render cache, proxies — plus the
  temporary folders EditPilot leaves behind, kept growing on disk for anyone
  whose Windows account name is not plain English, because the deletion was
  silently refusing any path with an accented character in it. Deleting a
  template with a Vietnamese name had the same problem.

### Changed
- Auto Highlights and B-roll Copilot now think only through the CLI you set up
  in EditPilot. Neither falls back to an OpenAI key any more, and when no CLI is
  configured they say so and offer to open EditPilot instead of quietly using
  something else.
- B-roll suggestions are written by that CLI rather than assembled from the most
  frequent words in the sentence, so a spot is described by what to film —
  "close-up of a 3D model turning under light, showing the polished metal and
  the frosted shell" — instead of by tags like `#độ #chỉ #tạo`. Where each
  cutaway goes is still worked out locally from the transcript.

## [1.0.3] - 2026-09-11

### Added
- Speech is transcribed once and shared. Auto captions, Auto Highlights and
  B-roll Copilot all read the same transcript, which is saved with the project,
  so the second and third of them cost nothing and work offline. Re-trimming a
  clip reads the words it still covers instead of transcribing again.
- Auto Highlights has its own **Create transcript** button, with a choice of
  whether the words should also appear as captions on the timeline. Analysing no
  longer starts a transcription behind your back.
- Highlights and hooks are written by the CLI you configured in EditPilot
  (Claude Code, Codex or Antigravity), so the feature no longer needs a separate
  OpenAI key. It falls back to OpenAI when no CLI is installed.
- B-roll Copilot lets you choose which footage to insert, and offers to import
  media when the project has none to spare.
- B-roll is inserted on its own **B-roll** track, created once and reused, so it
  can never land among the captions or on the footage it is covering.

### Fixed
- Caption progress read in Vietnamese while the app was set to English.
- EditPilot would not start with Codex CLI, failing with
  `unknown option '--skip-git-repo-check'`. On a machine with Claude Code also
  installed, it was launching Claude Code's program and handing it Codex's
  instructions.
- EditPilot with Codex could see KomfyEdit's tools but not use any of them, and
  reported that its permissions blocked access to the video.
- Clicking a timecode on EditPilot's confirmation card left the playhead where it
  was when the video was playing.
- Auto Highlights suggested segments that had nothing to do with the video: it
  was asking for highlights without sending any transcript, and the suggestions
  were invented. It now refuses rather than guessing.
- B-roll Copilot reported nothing to do on videos that are solid speech. It was
  counting the audio track — and, in a captioned project, the video itself — as
  footage already covering the picture, and it broke a stretch of talking apart
  at every breath between sentences.
- Inserting B-roll appeared to succeed but changed nothing on screen: the clip
  was placed among the captions, where nothing draws it, and it reused the video
  being edited, so it was the same picture either way.

## [1.0.2] - 2026-09-10

### Added
- EditPilot's confirmation card lists each cut it is about to make: click a row
  to jump the playhead there, and untick anything you would rather keep.
- The first video added to a new project now sets the project's frame size.

### Fixed
- Ctrl+B cuts at the playhead instead of at the mouse pointer.
- The preview no longer flickers when playback passes a sticker.
- Video filmed upright on a phone is no longer treated as landscape, so the crop
  frame and transform handles sit on the picture.
- Clip volume can be raised above 100% from the properties panel.
- Auto captions cover the whole timeline after a video has been cut, instead of
  stopping at the first cut.
- The app icon shows correctly on the Windows taskbar, in both the installed and
  the development build.
- Adding a sticker no longer leaves a blank image tile in the Import panel.

## [1.0.1] - 2026-09-10

### Fixed
- Small fixes found after packaging the first release.

## [1.0.0] - 2026-09-09

First release of KomfyEdit.
