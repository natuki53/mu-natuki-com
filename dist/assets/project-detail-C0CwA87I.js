import{p as $,a as j,i as k,b as E,e as r}from"./mobile-menu-C8hI6FXL.js";const A={"project.detail.back":"プロジェクト一覧へ","project.detail.overview":"概要","project.detail.facts":"数字と特徴","project.detail.highlights":"このプロジェクトのポイント","project.detail.technology":"使用技術","project.detail.links":"関連リンク","project.detail.notFoundTitle":"プロジェクトが見つかりません","project.detail.notFoundText":"指定されたプロジェクトページは存在しません。"},n=e=>String(e??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"),g=document.body.dataset.projectId,l=$.find(e=>e.id===g),I=document.getElementById("app");function o(e,t,i=""){return t==="en"&&r[e]!==void 0?r[e]:i||A[e]||r[e]||""}function w(e){if(!l)return null;const t=`project.${l.id}`;return{...l,title:o(`${t}.title`,e,l.title),category:o(`${t}.category`,e,l.category),summary:o(`${t}.summary`,e,l.summary),description:o(`${t}.description`,e,l.description),highlights:o(`${t}.highlights`,e,l.highlights),facts:o(`${t}.facts`,e,l.facts||[])}}function T(){I.innerHTML=`
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
  `}function M(e){const t=document.createElement("div");t.className="detail-media";const i=e.media||(e.cover?{type:"image",src:e.cover.src,title:e.cover.alt}:null);if(i){if(i.type==="video"){const a=document.createElement("video");a.src=i.src,a.controls=!0,a.playsInline=!0,a.preload="metadata",a.setAttribute("aria-label",i.title||`${e.title} video`),t.appendChild(a)}else if(i.type==="iframe"){const a=document.createElement("iframe");a.src=i.src,a.title=i.title||`${e.title} preview`,a.loading="lazy",a.allow="fullscreen; web-share; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",a.setAttribute("allowfullscreen",""),t.appendChild(a)}else if(i.type==="image"){const a=document.createElement("img");a.src=i.src,a.alt=i.title||`${e.title} image`,a.loading="lazy",t.appendChild(a)}}else{t.classList.add("detail-media-placeholder");const a=document.createElement("span");a.textContent=e.category;const c=document.createElement("strong");c.textContent=e.title,t.append(a,c)}return t}function S(e){const t=document.getElementById("project-content"),i=o("project.detail.notFoundTitle",e),a=o("project.detail.notFoundText",e),c=o("project.detail.back",e);document.title=`${i} | Natuki`,t.innerHTML=`
    <main id="main-content" class="project-detail-main not-found">
      <div>
        <h1>${n(i)}</h1>
        <p>${n(a)}</p>
        <a class="button button-primary" href="/#projects">${n(c)}</a>
      </div>
    </main>
  `}function q(e){const t=w(e);if(!t){S(e);return}const i={back:o("project.detail.back",e),overview:o("project.detail.overview",e),facts:o("project.detail.facts",e),highlights:o("project.detail.highlights",e),technology:o("project.detail.technology",e),links:o("project.detail.links",e)},a=t.highlights.map(s=>`<li><span aria-hidden="true"></span>${n(s)}</li>`).join(""),c=t.tags.map(s=>`<span>${n(s)}</span>`).join(""),d=(t.facts||[]).map(s=>`
        <li>
          <strong>${n(s.value)}</strong>
          <span>${n(s.label)}</span>
        </li>
      `).join(""),f=t.cover?`
      <figure class="detail-cover${t.cover.fit==="header"?" detail-cover-header":""}${t.cover.fit==="contain"?" detail-cover-contain":""}${t.cover.aspect==="square"?" detail-cover-square":""}">
        <img src="${n(t.cover.src)}" alt="${n(t.cover.alt||t.title)}" />
      </figure>
    `:"",b=t.links.map(s=>`
        <a class="detail-link" href="${n(s.url)}" target="_blank" rel="noopener noreferrer">
          <span>${n(s.label)}</span><span aria-hidden="true">↗</span>
        </a>
      `).join(""),y=document.getElementById("project-content");y.innerHTML=`
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
        <div class="detail-primary">
          <section class="detail-card detail-overview-card">
            <h2>${n(i.overview)}</h2>
            <p class="detail-description">${n(t.description)}</p>
          </section>
          <div id="project-media-slot"></div>
        </div>

        <aside class="detail-side">
          <section class="detail-card detail-highlights-card">
            <h2>${n(i.highlights)}</h2>
            <ul class="detail-highlights">${a}</ul>
          </section>
          <section class="detail-card detail-technology-card">
            <h2>${n(i.technology)}</h2>
            <div class="tags">${c}</div>
          </section>
          <section class="detail-card detail-links-card">
            <h2>${n(i.links)}</h2>
            <div class="detail-links">${b}</div>
          </section>
        </aside>
      </div>

    </main>
  `;const p=M(t);p&&document.getElementById("project-media-slot")?.appendChild(p),document.title=`${t.title} | Natuki`;const m=document.querySelector('meta[name="description"]');m&&m.setAttribute("content",t.summary);const u=document.querySelector('meta[property="og:title"]');u&&u.setAttribute("content",`${t.title} | Natuki`);const h=document.querySelector('meta[property="og:description"]');h&&h.setAttribute("content",t.summary)}function v(e){document.documentElement.lang=e,localStorage.setItem("lang",e),q(e),document.querySelectorAll(".segment-option[data-lang]").forEach(t=>{t.setAttribute("aria-pressed",t.dataset.lang===e?"true":"false")}),window.dispatchEvent(new CustomEvent("langchange",{detail:{lang:e}}))}document.body.classList.add("project-detail-page");T();j({currentProjectId:g});k();E();document.querySelectorAll(".segment-option[data-lang]").forEach(e=>{e.addEventListener("click",()=>{e.getAttribute("aria-pressed")!=="true"&&v(e.dataset.lang)})});v(localStorage.getItem("lang")||"ja");
