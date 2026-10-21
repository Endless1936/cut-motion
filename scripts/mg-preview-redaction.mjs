// This fictional interface belongs only to the preview, never to the overlay template.
export function redactionPreviewBackdrop(data) {
  const {x,y,width,height}=data.frame;
  return {
    style:`
    .redaction-demo{position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:1;overflow:hidden;border-radius:22px;background:#111a28;color:#e5eaf4;font:20px/1.4 "Smiley Sans",sans-serif;box-shadow:inset 0 0 0 1px #c1d3ff30,0 18px 64px #0006}
    .redaction-demo-header{position:absolute;inset:0 0 auto;height:70px;display:flex;align-items:center;gap:10px;padding:0 26px;border-bottom:1px solid #c1d3ff1f;background:#192538}
    .redaction-demo-dot{width:9px;height:9px;border-radius:50%;background:#a9bdff70}
    .redaction-demo-title{margin-left:15px;color:#c9d5e8;font-size:24px}
    .redaction-demo-message{position:absolute;left:322px;top:120px;width:466px;height:204px;border:1px solid #a9bdff20;border-radius:18px;background:#253c63}
    .redaction-demo-message-title{position:absolute;left:342px;top:138px;font-size:21px}
    .redaction-demo-row{position:absolute;left:342px;height:18px;font-size:18px;line-height:18px}
    .redaction-demo-link{position:absolute;left:400px;height:18px;font:18px/18px ui-monospace,monospace;color:#b8d7ff;white-space:nowrap}
    .redaction-demo-response{position:absolute;left:70px;top:392px;color:#a8b4ca;font-size:24px;line-height:1.7}
    .redaction-demo-avatar{position:absolute;left:24px;top:672px;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#55dda5;color:#122a26;font-size:23px}
    .redaction-demo-input{position:absolute;left:80px;right:30px;top:646px;height:86px;border:1px solid #c1d3ff24;border-radius:18px;background:#1b293f;display:flex;align-items:center;padding-left:25px;color:#7f90aa;font-size:23px}
    .redaction-demo-note{position:absolute;left:100px;right:100px;top:1235px;text-align:center;color:#a8b4ca;font:30px/1.3 "Smiley Sans",sans-serif}
    `,
    fragment:`<section class="redaction-demo" aria-label="虚构聊天界面示意"><div class="redaction-demo-header"><i class="redaction-demo-dot"></i><i class="redaction-demo-dot"></i><i class="redaction-demo-dot"></i><span class="redaction-demo-title">虚构工作会话 · 遮罩演示</span></div><div class="redaction-demo-message"></div><div class="redaction-demo-message-title">以下内容仅用于演示遮盖位置</div><div class="redaction-demo-row" style="top:180px">命令 A</div><div class="redaction-demo-link" style="top:180px">preview_resource_alpha_001</div><div class="redaction-demo-row" style="top:220px">命令 B</div><div class="redaction-demo-link" style="top:220px">preview_resource_beta_002</div><div class="redaction-demo-row" style="top:260px">命令 C</div><div class="redaction-demo-link" style="top:260px">preview_resource_gamma</div><div class="redaction-demo-response">正在整理示例内容…<br>保留说明文字，仅遮盖指定区域。</div><div class="redaction-demo-avatar">示</div><div class="redaction-demo-input">输入内容 · 虚构界面，无真实账号或链接</div></section><p class="redaction-demo-note">圆形头像 · 多条细遮罩 · 快速淡入淡出</p>`
  };
}

export async function verifyRedactionPreview(page, data) {
  return page.evaluate(data=>{
    const root=document.querySelector(".redaction-mask"),regions=[...root.querySelectorAll(".redaction-region")];
    const alpha=element=>{
      let result=1;
      for(let current=element;current&&current!==document.body;current=current.parentElement){
        const style=getComputedStyle(current);
        if(style.visibility==="hidden")return 0;
        result*=Number(style.opacity);
      }
      return result;
    };
    const read=time=>{window.seek(time);return regions.map(alpha)};
    const times=[.89,1.05,1.45,1.55,4.1,5.55,7.1],samples=times.map(time=>({time,alpha:read(time)}));
    const expected=[[0,0],[1,0],[1,.5],[1,1],[0,0],[1,1],[0,0]];
    const maxAlphaError=Math.max(...samples.flatMap((sample,index)=>sample.alpha.map((value,mask)=>Math.abs(value-expected[index][mask]))));
    const first=read(1.55);read(7.1);const again=read(1.55);
    let maxCoordinateErrorPx=0;
    regions.forEach((region,index)=>{
      const mask=data.masks[index];
      [...region.querySelectorAll(".redaction-rect")].forEach((element,rectIndex)=>{
        const rect=mask.rects[rectIndex],actual=element.getBoundingClientRect();
        const expected={left:data.frame.x+rect.x/data.coordinateSize.width*data.frame.width,top:data.frame.y+rect.y/data.coordinateSize.height*data.frame.height,width:rect.width/data.coordinateSize.width*data.frame.width,height:rect.height/data.coordinateSize.height*data.frame.height};
        for(const key of Object.keys(expected))maxCoordinateErrorPx=Math.max(maxCoordinateErrorPx,Math.abs(actual[key]-expected[key]));
      });
    });
    const colors=[...root.querySelectorAll(".redaction-rect")].map(element=>getComputedStyle(element).backgroundColor);
    window.seek(2.5);
    return {samples,maxAlphaError,maxCoordinateErrorPx,regions:regions.length,rects:root.querySelectorAll(".redaction-rect").length,reversible:JSON.stringify(first)===JSON.stringify(again),colors};
  },data);
}
