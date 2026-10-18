import fs from 'node:fs/promises';
import { fonts, css, poster, scenes } from './simple/guide.mjs';
const dir = new URL('.',import.meta.url);
const normalize = s => s.replaceAll('../assets/','assets/');
await fs.writeFile(new URL('simple/poster.html',dir),`<!doctype html><html lang="es-CR"><head><meta charset="UTF-8"><title>Comprobante por correo · Ajedrez Belén</title><style>${fonts}${css}</style></head><body>${poster}</body></html>`);
let start=0;
const hosts=[], timing=[];
for (const [i,s] of scenes.entries()) {
 const html=`<!doctype html><html lang="es"><head><meta charset="UTF-8"></head><body><template><style>#${s.id}{position:absolute;inset:0;width:100%;height:100%}</style><div id="${s.id}" class="scene" data-composition-id="${s.id}" data-width="1080" data-height="1920" data-duration="${s.duration}">
 <header class="brand"><img src="assets/crest-provisional.webp" alt="Escudo de Ajedrez Belén"><span>Ajedrez Belén</span></header>
 <p class="step-label">${i+1} / 3</p><h1>${s.title}</h1><div class="scene-visual">${s.visual}</div><p class="scene-note">${s.note}</p><p class="scene-foot">${s.foot}</p></div>
 <script>(function(){const tl=gsap.timeline({paused:true});tl.fromTo('#${s.id} h1',{y:18,opacity:0},{y:0,opacity:1,duration:.45,ease:'power3.out'},0);tl.fromTo('#${s.id} .scene-visual',{scale:.97,opacity:0},{scale:1,opacity:1,duration:.5,ease:'power3.out'},.12);tl.fromTo('#${s.id} .scene-note',{opacity:0},{opacity:1,duration:.3},.4);window.__timelines['${s.id}']=tl;})();</script></template></body></html>`;
 await fs.writeFile(new URL(`compositions/${s.id}.html`,dir),html);
 hosts.push(`<div id="host-${s.id}" class="clip" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html" data-start="${start}" data-duration="${s.duration}" data-track-index="0" data-track-kind="graphics" data-width="1080" data-height="1920"></div>`);
 timing.push({id:s.id,start,duration:s.duration,midpoint:start+s.duration/2});start+=s.duration;
}
// Keep the previously exported detailed version under versions/v1, not in the active scene scan.
for(let i=1;i<=5;i++) await fs.rm(new URL(`compositions/paso-0${i}.html`,dir),{force:true});
await fs.writeFile(new URL('index.html',dir),`<!doctype html><html lang="es"><head><meta charset="UTF-8"><title>Tu comprobante en 3 pasos</title><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><style>${normalize(fonts)}${css}
html,body{overflow:hidden}#root{position:relative;width:100%;height:100%;overflow:hidden}.clip{position:absolute;inset:0}.progress{position:absolute;left:108px;top:1740px;width:864px;height:7px;background:#d6ccb7;z-index:10}.fill{width:100%;height:100%;background:#b3222b;transform-origin:left center}
</style></head><body><div id="root" data-composition-id="guia-padres" data-width="1080" data-height="1920" data-duration="${start}">${hosts.join('')}<div class="progress"><div class="fill"></div></div></div><script>const tl=gsap.timeline({paused:true});tl.fromTo('.fill',{scaleX:0},{scaleX:1,duration:${start},ease:'none'},0);window.__timelines['guia-padres']=tl;</script></body></html>`);
await fs.writeFile(new URL('timing.json',dir),JSON.stringify({total:start,scenes:timing},null,2));
console.log(`Built simple poster and ${start}s tutorial.`);
