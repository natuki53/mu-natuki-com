import{p as j,a as k,i as I,b as w,e as r}from"./mobile-menu-XY5-lsDL.js";const E={"project.detail.back":"プロジェクト一覧へ","project.detail.overview":"概要","project.detail.facts":"数字と特徴","project.detail.highlights":"このプロジェクトのポイント","project.detail.technology":"使用技術","project.detail.links":"関連リンク","project.detail.notFoundTitle":"プロジェクトが見つかりません","project.detail.notFoundText":"指定されたプロジェクトページは存在しません。"},n=e=>String(e??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"),g={appstore:"/icons/links/cliprack-app.png",booth:"/icons/links/booth.png",github:"/icons/links/github.svg",manual:"/icons/links/description.svg",website:"/icons/links/language.svg",x:"/icons/links/x.png",youtube:"/icons/links/youtube.png"},A=e=>e.icon||g[e.type]||g.website,v=document.body.dataset.projectId,l=j.find(e=>e.id===v),S=document.getElementById("app");function s(e,t,i=""){return t==="en"&&r[e]!==void 0?r[e]:i||E[e]||r[e]||""}function T(e){if(!l)return null;const t=`project.${l.id}`;return{...l,title:s(`${t}.title`,e,l.title),category:s(`${t}.category`,e,l.category),summary:s(`${t}.summary`,e,l.summary),description:s(`${t}.description`,e,l.description),highlights:s(`${t}.highlights`,e,l.highlights),facts:s(`${t}.facts`,e,l.facts||[])}}function x(){S.innerHTML=`
    <a class="skip-link" href="#main-content">本文へ移動</a>
    <header class="site-header">
      <div class="header-inner">
        <a class="site-brand" href="/" aria-label="ホームへ戻る">
          <span class="brand-title">雨苺なつき</span>
          <span class="brand-subtitle">PORTFOLIO</span>
        </a>
        <button type="button" class="mobile-menu-toggle" aria-expanded="false" aria-controls="mobile-menu-panel"
          aria-label="メニューを開く">
          <span></span><span></span><span></span>
        </button>
        <div id="mobile-menu-panel" class="mobile-menu-panel">
          <nav class="menu-nav" aria-label="ページナビゲーション">
            <div id="project-menu-host"></div>
          </nav>
          <div class="header-tools">
            <div id="theme-toggle" class="segment-group" role="group" aria-label="テーマを切り替え">
              <button type="button" class="segment-option" data-theme="light" aria-pressed="false" aria-label="ライトテーマ">☀</button>
              <button type="button" class="segment-option" data-theme="dark" aria-pressed="false" aria-label="ダークテーマ">☾</button>
            </div>
            <div id="lang-toggle" class="segment-group lang-segment" role="group" aria-label="言語を切り替え">
              <button type="button" class="segment-option" data-lang="ja" aria-pressed="false">JA</button>
              <button type="button" class="segment-option" data-lang="en" aria-pressed="false">EN</button>
            </div>
          </div>
        </div>
      </div>
    </header>
    <div id="project-content"></div>
    <footer class="site-footer">
      <p>© <span id="footer-year">${new Date().getFullYear()}</span> Natuki</p>
    </footer>
  `}function L(e){const t=document.createElement("div");t.className="detail-media";const i=e.media||(e.cover?{type:"image",src:e.cover.src,title:e.cover.alt}:null);if(i){if(i.type==="video"){const a=document.createElement("video");a.src=i.src,a.controls=!0,a.playsInline=!0,a.preload="metadata",a.setAttribute("aria-label",i.title||`${e.title} video`),t.appendChild(a)}else if(i.type==="iframe"){const a=document.createElement("iframe");a.src=i.src,a.title=i.title||`${e.title} preview`,a.loading="lazy",a.allow="fullscreen; web-share; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",a.setAttribute("allowfullscreen",""),t.appendChild(a)}else if(i.type==="image"){const a=document.createElement("img");a.src=i.src,a.alt=i.title||`${e.title} image`,a.loading="lazy",t.appendChild(a)}}else{t.classList.add("detail-media-placeholder");const a=document.createElement("span");a.textContent=e.category;const c=document.createElement("strong");c.textContent=e.title,t.append(a,c)}return t}function M(e){const t=document.getElementById("project-content"),i=s("project.detail.notFoundTitle",e),a=s("project.detail.notFoundText",e),c=s("project.detail.back",e);document.title=`${i} | Natuki`,t.innerHTML=`
    <main id="main-content" class="project-detail-main not-found">
      <div>
        <h1>${n(i)}</h1>
        <p>${n(a)}</p>
        <a class="button button-primary" href="/#projects">${n(c)}</a>
      </div>
    </main>
  `}function N(e){const t=T(e);if(!t){M(e);return}const i={back:s("project.detail.back",e),overview:s("project.detail.overview",e),facts:s("project.detail.facts",e),highlights:s("project.detail.highlights",e),technology:s("project.detail.technology",e),links:s("project.detail.links",e)},a=t.highlights.map(o=>`<li><span aria-hidden="true"></span>${n(o)}</li>`).join(""),c=t.tags.map(o=>`<span>${n(o)}</span>`).join(""),d=(t.facts||[]).map(o=>`
        <li>
          <strong>${n(o.value)}</strong>
          <span>${n(o.label)}</span>
        </li>
      `).join(""),f=t.cover?`
      <figure class="detail-cover${t.cover.fit==="header"?" detail-cover-header":""}${t.cover.fit==="contain"?" detail-cover-contain":""}${t.cover.aspect==="square"?" detail-cover-square":""}">
        <img src="${n(t.cover.src)}" alt="${n(t.cover.alt||t.title)}" />
      </figure>
    `:"",y=t.links.map(o=>`
        <a class="detail-link" href="${n(o.url)}" target="_blank" rel="noopener noreferrer">
          <span class="detail-link-main">
            <span class="detail-link-icon"><img src="${n(A(o))}" alt="" /></span>
            <span>${n(o.label)}</span>
          </span>
          <span class="detail-link-arrow" aria-hidden="true">↗</span>
        </a>
      `).join(""),$=document.getElementById("project-content");$.innerHTML=`
    <main id="main-content" class="project-detail-main">
      <a class="detail-back" href="/#projects"><span aria-hidden="true">←</span>${n(i.back)}</a>

      <section class="detail-hero${t.cover?"":" detail-hero-no-cover"}">
        <div class="detail-hero-copy">
          <p class="project-category">${n(t.category)}</p>
          <h1 class="detail-title">${n(t.title)}</h1>
          <p class="detail-summary">${n(t.summary)}</p>
        </div>
        ${f}
      </section>

      ${d?`
        <section class="detail-facts" aria-labelledby="detail-facts-heading">
          <h2 id="detail-facts-heading">${n(i.facts)}</h2>
          <ul>${d}</ul>
        </section>
      `:""}

      <div class="detail-layout">
        <section class="detail-card detail-overview-card">
          <h2>${n(i.overview)}</h2>
          <p class="detail-description">${n(t.description)}</p>
        </section>
        <div id="project-media-slot"></div>
        <section class="detail-card detail-highlights-card">
          <h2>${n(i.highlights)}</h2>
          <ul class="detail-highlights">${a}</ul>
        </section>
        <aside class="detail-side">
          <section class="detail-card detail-technology-card">
            <h2>${n(i.technology)}</h2>
            <div class="tags" data-count="${t.tags.length}">${c}</div>
          </section>
          <section class="detail-card detail-links-card">
            <h2>${n(i.links)}</h2>
            <div class="detail-links">${y}</div>
          </section>
        </aside>
      </div>

    </main>
  `;const p=L(t);p&&document.getElementById("project-media-slot")?.appendChild(p),document.title=`${t.title} | Natuki`;const m=document.querySelector('meta[name="description"]');m&&m.setAttribute("content",t.summary);const u=document.querySelector('meta[property="og:title"]');u&&u.setAttribute("content",`${t.title} | Natuki`);const h=document.querySelector('meta[property="og:description"]');h&&h.setAttribute("content",t.summary)}function b(e){document.documentElement.lang=e,localStorage.setItem("lang",e),N(e),document.querySelectorAll(".segment-option[data-lang]").forEach(t=>{t.setAttribute("aria-pressed",t.dataset.lang===e?"true":"false")}),window.dispatchEvent(new CustomEvent("langchange",{detail:{lang:e}}))}document.body.classList.add("project-detail-page");x();k({currentProjectId:v});I();w();document.querySelectorAll(".segment-option[data-lang]").forEach(e=>{e.addEventListener("click",()=>{e.getAttribute("aria-pressed")!=="true"&&b(e.dataset.lang)})});b(localStorage.getItem("lang")||"ja");
