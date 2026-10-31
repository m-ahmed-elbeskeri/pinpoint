const REMEMBER_RULE = [
  'If the user states a lasting preference for this project ("always…", "never…", "from now on…", a brand rule),',
  'end your reply with one line exactly like `REMEMBER: <the rule in one short sentence>`.',
  "Otherwise don't add that line.",
].join(' ');

const HOW_TO_WORK = [
  '1. Look at the screenshots first. They are attached to this message (the paths above are the same files) and show exactly what the user sees and marked up.',
  [
    '2. Find the source that renders each annotated element.',
    'Start from the source hint if there is one; otherwise search for distinctive visible text, class names or ids from the rendered HTML.',
    'The rendered HTML is compiled output: map it back to the component/template that produces it, and do not edit build output.',
  ].join(' '),
  [
    "3. Read the user's markup this way: arrows mean move or point to; circles or boxes mean focus on this; a cross or scribble means remove; handwritten words are instructions.",
    'The pen color is only markup, not a color the user wants, unless the note says so.',
  ].join(' '),
  [
    '4. Make focused edits that do exactly what was asked.',
    "Follow the conventions already in the codebase (styling approach, design tokens, component patterns). Don't refactor unrelated code.",
  ].join(' '),
];

const STEP_BACKGROUND = [
  '5. You are working in a separate copy of the project so the user can keep working in theirs.',
  "No dev server is running here; don't start one or run builds. Make the edits and finish.",
].join(' ');

const STEP_SITE = [
  '5. Your edits will not show on the page the user has open, so you cannot check the result by looking at it.',
  "Don't start servers, run production builds or deploy.",
  'Run a quick type check or lint only if it is cheap, and say in your summary what the user should look for once the change is live.',
].join(' ');

const STEP_DEV = [
  "5. The dev server is already running with hot reload, so don't start servers or run production builds.",
  'Run a quick type check or lint only if it is cheap.',
].join(' ');

const STEP_FINISH = '6. Finish with a short summary: what you changed, with file paths, and anything you could not do or had to guess.';

const INTRO = (projectDir) => [
  'The user is looking at their web app in Pinpoint, a visual editor with an embedded browser.',
  `They picked elements, drew on the page and/or sketched ideas, and want you to change the code in this project (${projectDir}) so the page matches what they asked for.`,
].join(' ');

const RESPONSIVE = (width) => [
  `- The user is in responsive mode at ${width}px wide, so this request (including any live tweaks) is about the layout at this width.`,
  'Put the change in the breakpoint / responsive variant that applies here and leave other widths as they are, unless they ask for it everywhere.',
].join(' ');

const SITE_LIVE = [
  'This is the DEPLOYED site, not a local dev build.',
  'A deployed build carries no source hints, and its class names may be hashed or minified, so find the code from the visible text and structure.',
  'The project on disk may already be ahead of what is deployed: read the current code before deciding what to change.',
  'Your edits go to the local files and will not appear on this page until they are deployed, so the page looking the same afterwards does not mean the change failed.',
].join(' ');

const SITE_BUILT = [
  'This page is served from a built copy of the project running locally, with no hot reload.',
  'There are no source hints, and your edits will not show on it until the project is rebuilt; do not run the build yourself unless asked.',
].join(' ');

const DIAGNOSTICS_HOW = [
  'When fixing them: open the file and line an error names before changing anything, treat the earliest error as the likely cause of the ones after it,',
  'and for a failed request check the code that serves that URL as well as the code that calls it.',
].join(' ');

const DESIGN_SYSTEM_RULE = [
  '- Rule: express colors, spacing, radii, type and shadows with these tokens/utilities.',
  'If a requested value has no exact token, use the nearest one and say so; add a new token only when the user asks for a value the system clearly lacks.',
].join(' ');

const VARIANT_FIRST = (total) => [
  `The user wants to see ${total} different takes on this request and pick one.`,
  'This is the first. Make a complete, working version; the next variants will be asked for separately.',
].join(' ');

const VARIANT_NEXT = (index) => [
  'Your previous variant was saved and its files have been restored to how they were before it, so the project is back at the starting point (re-read files before editing).',
  `Now do the same request again as variant ${index}: a clearly different design direction from the earlier one${index > 2 ? 's' : ''}`,
  "(different layout, emphasis or styling choices, not a small tweak), still within the project's design system.",
].join(' ');

const VERIFY_SAME = [
  'IMPORTANT: the two screenshots are pixel-for-pixel identical. Your edit made no visible difference on this page.',
  'Unless the request was about something that cannot be seen (a refactor, an invisible attribute), work out why and fix it:',
  'the wrong file or selector, a rule overridden by a more specific one, a change that only applies in another state or breakpoint, or a build that did not pick the file up.',
].join(' ');

const VERIFY_CLOSE = [
  'If something is wrong, fix it now and say in one or two sentences what you fixed.',
  'If it all looks right, reply with one short sentence saying so and change nothing. Do not make improvements nobody asked for.',
].join(' ');

const NO_NOTE = '(no note; infer the intent from the image and the overall request)';

module.exports = {
  REMEMBER_RULE, HOW_TO_WORK, STEP_BACKGROUND, STEP_SITE, STEP_DEV, STEP_FINISH, INTRO, RESPONSIVE, SITE_LIVE, SITE_BUILT,
  DIAGNOSTICS_HOW, DESIGN_SYSTEM_RULE, VARIANT_FIRST, VARIANT_NEXT, VERIFY_SAME, VERIFY_CLOSE, NO_NOTE,
};
