// Small semantic vectors share one optical frame; caller-supplied markup is never accepted.
const paths = {
  document:'<path d="M9 4h10l5 5v19H9zM19 4v6h5M13 15h7M13 20h7M13 25h4"/>',
  folder:'<path d="M4 10V7h9l3 4h12v16H4zM4 15h24"/>',
  text:'<path d="M6 8h20M16 8v18M11 26h10M6 15h4M22 15h4"/>',
  image:'<rect x="4" y="5" width="24" height="22" rx="4"/><circle cx="11" cy="12" r="2"/><path d="m5 24 8-8 5 5 4-4 5 6"/>',
  video:'<rect x="4" y="7" width="24" height="20" rx="4"/><path d="m14 12 7 5-7 5zM9 7V4M23 7V4"/>',
  wave:'<path d="M4 14v4M10 8v16M16 4v24M22 9v14M28 13v6"/>',
  spark:'<path d="m16 3 4 9 9 4-9 4-4 9-4-9-9-4 9-4zM25 3v5M23 5h5"/>',
  cloud:'<path d="M9 25a7 7 0 0 1-1-14 9 9 0 0 1 17-1 7 7 0 0 1 0 14M12 21l4-4 4 4M16 17v12"/>',
  scene:'<path d="m5 14 11-9 11 9v14H5zM12 28V18h8v10"/>',
  person:'<circle cx="16" cy="10" r="5"/><path d="M5 28v-3c0-6 5-9 11-9s11 3 11 9v3"/>',
  language:'<path d="M4 8h15M11 4v4M7 8c0 8 7 13 12 15M17 8c-1 7-6 13-13 16M21 16l6 12M19 24h9"/>',
  check:'<circle cx="16" cy="16" r="12"/><path d="m10 16 4 4 8-9"/>',
  layers:'<path d="m3 10 13-6 13 6-13 6zM4 17l12 6 12-6M4 23l12 6 12-6"/>',
  cut:'<circle cx="8" cy="9" r="4"/><circle cx="8" cy="23" r="4"/><path d="m11 12 17 15M11 20 28 5M18 16l-7 4"/>',
  arrow:'<path d="M4 16h23M19 8l8 8-8 8"/>',
  grid:'<rect x="4" y="4" width="9" height="9" rx="2"/><rect x="19" y="4" width="9" height="9" rx="2"/><rect x="4" y="19" width="9" height="9" rx="2"/><rect x="19" y="19" width="9" height="9" rx="2"/>',
  clock:'<circle cx="16" cy="16" r="12"/><path d="M16 8v9l6 3"/>',
  chart:'<path d="M5 4v24h24M10 22l6-7 5 3 7-12M23 6h5v5"/>'
};
const inferred = [
  [/BGM|音乐|声音|配音|音频|音效/i,'wave'], [/场景|居家|空间/,'scene'],
  [/人物|角色|长相|演员/,'person'], [/语言|转写|翻译/,'language'],
  [/剪辑|裁剪/,'cut'], [/视频|成片|拍摄|录制/,'video'],
  [/图片|画面|生图|图像/,'image'], [/文案|文本|稿|摘要|图文/,'text'],
  [/文件|素材|资源/,'folder'], [/云端|上传/,'cloud'],
  [/验证|确认|目标|完成/,'check'], [/模型|Agent|智能|编排|自动/i,'spark']
];
export function mgIcon(label='', requested) {
  const name = Object.hasOwn(paths,requested??'') ? requested : inferred.find(([pattern])=>pattern.test(label))?.[1]??'layers';
  return `<svg class="mg-icon" viewBox="0 0 32 32" aria-hidden="true">${paths[name]}</svg>`;
}
