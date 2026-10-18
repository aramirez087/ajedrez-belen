import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const project=new URL('.',import.meta.url),out=new URL('../../output/guia-padres-2026-10-17/',project);
await fs.mkdir(out,{recursive:true});
const internal=new URL('.hyperframes/delivery-assets/',project);
await fs.mkdir(internal,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1080,height:1350},deviceScaleFactor:1});
 await page.route(/^https?:/,route=>route.abort());
 await page.goto(new URL('simple/poster.html',project).href);
 await page.evaluate(()=>document.fonts.ready);
 const report=await page.evaluate(()=>{
  const box=document.querySelector('.poster').getBoundingClientRect();
  const findings=[];
  for(const el of document.querySelectorAll('.poster *')){
   if(el.children.length||!el.textContent.trim())continue;
   const r=el.getBoundingClientRect();
   if(r.width<1||r.height<1)continue;
   if(r.left<box.left||r.right>box.right||r.top<box.top||r.bottom>box.bottom)findings.push(el.textContent.trim());
   if(el.clientWidth&&el.scrollWidth>el.clientWidth+2)findings.push('Overflow: '+el.textContent.trim());
  }
  return {width:box.width,height:box.height,findings,fontsLoaded:document.fonts.status==='loaded',words:document.querySelector('.poster').innerText.trim().split(/\s+/).length};
 });
 await page.locator('.poster').screenshot({path:fileURLToPath(new URL('guia-rapida.png',internal))});
 await page.locator('.poster').screenshot({path:fileURLToPath(new URL('01-guia.jpg',out)),type:'jpeg',quality:94});
 await fs.writeFile(new URL('verificacion-imagen.json',internal),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
 if(report.findings.length||!report.fontsLoaded)process.exitCode=1;
}finally{await browser.close()}
