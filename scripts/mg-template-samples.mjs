// Public demonstration content only; no job-specific transcript or media.
// Pixel bounds refer to the 960×660 sample SVG's marked information rows.
const sampleRow = y => ({x:68/960*100,y:y/660*100,width:824/960*100,height:132/660*100});
export const evidenceSampleFocus = [172,324,476].map(sampleRow);
export const templateSamples = {
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
  }
};
