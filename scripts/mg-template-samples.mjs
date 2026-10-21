// Public demonstration content only; no job-specific transcript or media.
// Pixel bounds refer to the 960×660 sample SVG's marked information rows.
const sampleRow = y => ({x:68/960*100,y:y/660*100,width:824/960*100,height:132/660*100});
export const evidenceSampleFocus = [172,324,476].map(sampleRow);
export const templateSamples = {
  "metric-grid": {
    title: "单条内容 · 演示数据",
    items: [{label:"播放",value:"24.8万"},{label:"收藏",value:"3,200",unit:"次"},{label:"转化",value:"480",unit:"次",emphasis:true}]
  },
  "comparison-table": {
    title: "同一任务 · 资源消耗",
    headers: ["预览后精修","直接制作"],
    rows: [{values:["试稿 → 定稿","直接成片"]},{values:["高清画面","高清画面"]},{values:["180 点","720 点"],emphasis:true,reveal:"cells"}]
  },
  "factor-expansion": {
    source: "成熟内容", structure: "保留结构",
    items: [{label:"画面",value:"×4",icon:"image"},{label:"声音",value:"×3",icon:"wave"},{label:"场景",value:"×3",icon:"scene"}],
    result: "更多内容方案"
  },
  "growth-trend": {
    title: "内容表现 · 趋势示意",
    items: [{label:"起步",value:12},{label:"积累",value:24},{label:"验证",value:48},{label:"增长",value:88}],
    result: "持续增长"
  },
  "ordered-steps": {
    "title": "完整生产流程",
    "items": [
      "初始化",
      "文案",
      "生图",
      "音频",
      "成片"
    ]
  },
  "parallel-points": {
    "layout": "chips",
    "items": [
      "项目文件",
      "图片",
      "视频",
      "音频",
      "模型"
    ],
    "conclusion": "全部在云端"
  },
  "linear-flow": {
    "layout": "vertical",
    "title": "原先的手动步骤",
    "items": [
      "打开剪映",
      "朗读文案",
      "导出配音",
      "发送给 Agent"
    ]
  },
  "relation-map": {
    "source": "一个想法",
    "items": [
      "图文",
      "视频",
      "播客"
    ]
  },
  "converge-sources": {
    "items": [
      "文案",
      "画面",
      "音频",
      "剪辑"
    ],
    "result": "豆包"
  },
  "map-transform": {
    "source": "口播素材",
    "result": "完整成片"
  },
  "comparison": {
    "title": "制作方式",
    "items": [
      {
        "label": "手动",
        "description": "逐项操作"
      },
      {
        "label": "Agent",
        "description": "统一编排"
      }
    ]
  },
  "metric-proof": {
    "source": "此前视频",
    "value": "40多万",
    "unit": "人看过",
    "caption": "图书带货视频"
  },
  "evidence-focus": {
    "image": "assets/sample-evidence.svg",
    "alt": "示例证据",
    "focus": evidenceSampleFocus.slice(0,2)
  },
  "quote": {
    "text": "让工具\n跟着表达走",
    "credit": "创作原则"
  },
  "code-snippet": {
    "title": "执行指令",
    "items": [
      "读取素材",
      "识别口播内容",
      "按关键词调度 MG",
      "导出成片"
    ],
    "highlightIndex": 2
  },
  "correction": {
    "old": "接模型 API",
    "replacement": "豆包工作任务"
  },
  "annotation": {
    "items": [
      "口播决定节奏",
      "动画跟随内容"
    ]
  },
  "redaction-mask": {
    frame: {x:100,y:420,width:880,height:760},
    coordinateSize: {width:880,height:760},
    color: "#2b2a2c", opacity: 1,
    masks: [
      {id:"avatar",rects:[{x:24,y:672,width:36,height:36,radius:18}],windows:[[.9,1,3.9,4],[4.9,5,6.9,7]]},
      {id:"links",rects:[{x:400,y:180,width:300,height:18,radius:2},{x:400,y:220,width:300,height:18,radius:2},{x:400,y:260,width:240,height:18,radius:2}],windows:[[1.4,1.5,3.9,4],[5.4,5.5,6.9,7]]}
    ]
  }
};
