import{i as C,a as P,b as M}from"./mobile-menu-C8hI6FXL.js";import{i as D}from"./i18n-h1wViYNM.js";const w="/api/admin/v1",L=15e3,x={ja:{loading:"読み込み中…",unavailable:"情報を取得できませんでした。",noData:"表示できるデータはありません。",online:"稼働中",degraded:"一部異常",offline:"停止中",activeCount:"出勤中",servicesOnline:"稼働サービス",hostCpu:"CPU",hostMemory:"メモリ",shifts:"勤務回数",workDays:"勤務日数",workTotal:"勤務合計",breakTotal:"休憩合計",working:"勤務中",break:"休憩中",records:t=>`${t}件`,edit:"修正",start:"開始",stop:"停止",restart:"再起動",actionConfirm:(t,e)=>`${e}を${t}します。状態が切り替わるまで少し時間がかかることがあります。`,actionDone:"サービス操作が完了しました。",correctionDone:"勤務明細を修正しました。",signedInError:"管理APIへ接続できません。Cloudflare Accessの設定を確認してください。",refreshed:"最新の状態へ更新しました。",component:"構成",restartCount:"再起動",times:"回",page:(t,e)=>`${t} / ${e} ページ`},en:{loading:"Loading…",unavailable:"The information could not be loaded.",noData:"There is no data to display.",online:"Online",degraded:"Degraded",offline:"Stopped",activeCount:"Clocked in",servicesOnline:"Services online",hostCpu:"CPU",hostMemory:"Memory",shifts:"Shifts",workDays:"Work days",workTotal:"Total work",breakTotal:"Total breaks",working:"Working",break:"On break",records:t=>`${t} records`,edit:"Edit",start:"Start",stop:"Stop",restart:"Restart",actionConfirm:(t,e)=>`${t} ${e}. The state may take a moment to update.`,actionDone:"The service operation completed.",correctionDone:"The attendance record was corrected.",signedInError:"The administration API is unavailable. Check the Cloudflare Access configuration.",refreshed:"The latest state has been loaded.",component:"Component",restartCount:"Restarts",times:"",page:(t,e)=>`Page ${t} of ${e}`}},n={session:null,activeTab:"overview",services:[],records:[],recordTotal:0,recordPage:1,recordPageSize:25,editingRecord:null,pendingServiceAction:null},h=()=>document.documentElement.lang==="en"?"en":"ja",r=()=>x[h()],o=t=>String(t??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"),y=t=>{const e=document.getElementById("toast");e&&(e.textContent=t,e.classList.remove("hidden"),clearTimeout(y.timeout),y.timeout=setTimeout(()=>e.classList.add("hidden"),2800))},m=t=>{const e=document.getElementById("admin-global-message");e&&(e.textContent=t,e.hidden=!1)},l=async(t,e={})=>{const a=new AbortController,i=setTimeout(()=>a.abort(),L),s=new Headers(e.headers||{});s.set("Accept","application/json"),e.body&&s.set("Content-Type","application/json"),e.method&&!["GET","HEAD"].includes(e.method)&&s.set("X-CSRF-Token",n.session?.csrfToken||"");try{const d=await fetch(`${w}${t}`,{...e,headers:s,cache:"no-store",credentials:"same-origin",signal:a.signal}),c=await d.json().catch(()=>({}));if(!d.ok)throw new Error(c?.error?.message||`${d.status} ${d.statusText}`);return c}finally{clearTimeout(i)}},v=t=>{if(!Number.isFinite(Number(t)))return"—";const e=Math.max(0,Math.floor(Number(t)/60)),a=Math.floor(e/60),i=e%60;return h()==="en"?`${a}h ${i}m`:`${a}時間 ${i}分`},f=(t,e=!0)=>{if(!t)return"—";const a=new Date(t);return Number.isNaN(a.getTime())?"—":new Intl.DateTimeFormat(h()==="en"?"en-US":"ja-JP",{...e?{month:"short",day:"numeric"}:{},hour:"2-digit",minute:"2-digit"}).format(a)},b=t=>r()[t]||t,u=(t,e,a="")=>`
  <article class="admin-summary-card">
    <span>${o(t)}</span>
    <strong>${o(e)}</strong>
    ${a?`<small>${o(a)}</small>`:""}
  </article>
`,j=async()=>{const t=document.getElementById("admin-overview-cards"),e=document.getElementById("overview-services");t?.setAttribute("aria-busy","true");try{const a=await l("/overview");n.services=a.services||[];const i=n.services.filter(c=>c.state==="online").length,s=a.publicStatus?.["server-status"];t&&(t.innerHTML=[u(r().servicesOnline,`${i} / ${n.services.length}`),u(r().activeCount,String(a.activeAttendanceCount??0)),u(r().hostCpu,s?`${Math.round(s.cpuPct)}%`:"—"),u(r().hostMemory,s?`${Math.round(s.memoryPct)}%`:"—")].join("")),e&&(e.innerHTML=n.services.length?n.services.map(c=>`
                <div class="admin-compact-row">
                  <span class="admin-state-dot" data-state="${o(c.state)}"></span>
                  <strong>${o(c.displayName)}</strong>
                  <span>${o(b(c.state))}</span>
                </div>
              `).join(""):`<p class="admin-empty">${r().noData}</p>`);const d=document.getElementById("overview-updated");d&&(d.textContent=f(a.measuredAt))}catch(a){throw t&&(t.innerHTML=`<p class="admin-empty">${o(r().unavailable)}</p>`),e&&(e.innerHTML=""),a}finally{t?.setAttribute("aria-busy","false")}},S=()=>document.getElementById("timecard-month")?.value||"",E=()=>document.getElementById("timecard-member")?.value||"",N=()=>{const t=new URLSearchParams({month:S()});return E()&&t.set("memberId",E()),t},O=async()=>{const t=document.getElementById("timecard-member");if(!t)return;const e=t.value,a=await l("/timecard/members"),i=h()==="en"?"All members":"全員";t.innerHTML=`<option value="">${i}</option>${(a.items||[]).map(s=>`<option value="${o(s.id)}">${o(s.displayName)}</option>`).join("")}`,[...t.options].some(s=>s.value===e)&&(t.value=e)},R=t=>{const e=document.getElementById("timecard-summary");e&&(e.innerHTML=[u(r().shifts,String(t.shiftCount??0)),u(r().workDays,String(t.workDayCount??0)),u(r().workTotal,v(t.workSeconds)),u(r().breakTotal,v(t.breakSeconds))].join(""),e.setAttribute("aria-busy","false"))},H=t=>{const e=document.getElementById("timecard-active-list");e&&(e.innerHTML=t.length?t.map(a=>`
            <div class="admin-compact-row admin-active-row">
              <span class="admin-state-dot" data-state="${a.state==="break"?"degraded":"online"}"></span>
              <strong>${o(a.displayName)}</strong>
              <span>${o(r()[a.state])} · ${o(v(a.workSeconds))}</span>
              <small>${o(f(a.startAt))}</small>
            </div>
          `).join(""):`<p class="admin-empty">${o(r().noData)}</p>`)},T=t=>{n.records=t.items||[],n.recordTotal=t.total||0,n.recordPage=t.page||n.recordPage,n.recordPageSize=t.pageSize||n.recordPageSize;const e=document.getElementById("timecard-records"),a=document.getElementById("timecard-record-count");a&&(a.textContent=r().records(n.recordTotal));const i=Math.max(1,Math.ceil(n.recordTotal/n.recordPageSize)),s=document.getElementById("timecard-page-label"),d=document.getElementById("timecard-page-prev"),c=document.getElementById("timecard-page-next");s&&(s.textContent=r().page(n.recordPage,i)),d&&(d.disabled=n.recordPage<=1),c&&(c.disabled=n.recordPage>=i),e&&(e.innerHTML=n.records.length?n.records.map(g=>`
            <tr>
              <td><strong>${o(g.displayName)}</strong></td>
              <td>${o(f(g.startAt))}</td>
              <td>${o(f(g.endAt))}</td>
              <td>${o(v(g.breakSeconds))}</td>
              <td>${o(v(g.workSeconds))}</td>
              <td>
                <button class="admin-table-action" type="button" data-edit-record="${g.id}">
                  ${o(r().edit)}
                </button>
              </td>
            </tr>
          `).join(""):`<tr><td colspan="6" class="admin-empty">${o(r().noData)}</td></tr>`)},p=async()=>{document.getElementById("timecard-summary")?.setAttribute("aria-busy","true");const e=N(),[a,i,s]=await Promise.all([l(`/timecard/summary?${e}`),l("/timecard/active"),l(`/timecard/records?${e}&page=${n.recordPage}&pageSize=${n.recordPageSize}`)]);R(a),H(i.items||[]),T(s);const d=document.getElementById("timecard-export");d&&(d.href=`${w}/timecard/export.csv?${e}`)},z=t=>`
  <li>
    <span>${o(t.name)}</span>
    <span>${o(b(t.state))}</span>
    <small>${o(r().restartCount)} ${t.restartCount}${o(r().times)}</small>
  </li>
`,A=()=>{const t=document.getElementById("admin-services-grid");t&&(t.innerHTML=n.services.map(e=>`
        <article class="admin-service-card" data-state="${o(e.state)}">
          <div class="admin-service-heading">
            <div>
              <p class="admin-card-kicker">${o(e.id)}</p>
              <h3>${o(e.displayName)}</h3>
            </div>
            <span class="admin-state-badge">
              <span class="admin-state-dot" data-state="${o(e.state)}"></span>
              ${o(b(e.state))}
            </span>
          </div>
          <ul class="admin-component-list">
            ${(e.components||[]).map(z).join("")}
          </ul>
          <div class="admin-service-actions">
            ${["start","restart","stop"].map(a=>`
                  <button type="button"
                    class="admin-button ${a==="stop"?"admin-button-danger-outline":"admin-button-secondary"}"
                    data-service-id="${o(e.id)}"
                    data-service-name="${o(e.displayName)}"
                    data-service-action="${a}">
                    ${o(r()[a])}
                  </button>
                `).join("")}
          </div>
        </article>
      `).join(""),t.setAttribute("aria-busy","false"))},k=async()=>{document.getElementById("admin-services-grid")?.setAttribute("aria-busy","true");const e=await l("/services");n.services=e.items||[],A()},U=async()=>{const t=document.getElementById("admin-audit-list");t?.setAttribute("aria-busy","true");const e=await l("/audit?limit=100");t&&(t.innerHTML=(e.items||[]).length?e.items.map(a=>`
              <article class="admin-audit-entry">
                <span class="admin-state-dot" data-state="${a.status==="succeeded"?"online":a.status==="running"?"degraded":"offline"}"></span>
                <div>
                  <strong>${o(a.action)} · ${o(a.target)}</strong>
                  <p>${o(a.detail||"")}</p>
                </div>
                <div class="admin-audit-meta">
                  <span>${o(a.actor)}</span>
                  <time>${o(f(a.created_at))}</time>
                </div>
              </article>
            `).join(""):`<p class="admin-empty">${o(r().noData)}</p>`,t.setAttribute("aria-busy","false"))},B={overview:j,timecard:p,services:k,audit:U},$=async t=>{n.activeTab=t,document.querySelectorAll("[data-admin-tab]").forEach(e=>{const a=e.dataset.adminTab===t;e.classList.toggle("is-active",a),e.setAttribute("aria-selected",String(a))}),document.querySelectorAll("[data-admin-panel]").forEach(e=>{const a=e.dataset.adminPanel===t;e.classList.toggle("is-active",a),e.hidden=!a});try{await B[t]?.()}catch(e){m(e.message||r().unavailable)}},q=t=>{const e=t.dataset.serviceAction,a=t.dataset.serviceName;n.pendingServiceAction={id:t.dataset.serviceId,action:e,name:a};const i=document.getElementById("service-action-title"),s=document.getElementById("service-action-description");i&&(i.textContent=`${r()[e]} · ${a}`),s&&(s.textContent=r().actionConfirm(r()[e],a)),document.getElementById("service-action-dialog")?.showModal()},F=async()=>{if(!n.pendingServiceAction)return;const{id:t,action:e}=n.pendingServiceAction;await l(`/services/${encodeURIComponent(t)}/actions`,{method:"POST",body:JSON.stringify({action:e,requestId:crypto.randomUUID()})}),y(r().actionDone),await k()},I=t=>{const e=new Date(t),a=e.getTimezoneOffset()*6e4;return new Date(e.getTime()-a).toISOString().slice(0,19)},V=t=>{const e=n.records.find(a=>String(a.id)===String(t));e&&(n.editingRecord=e,document.getElementById("attendance-edit-member").textContent=e.displayName,document.getElementById("attendance-edit-start").value=I(e.startAt),document.getElementById("attendance-edit-end").value=I(e.endAt),document.getElementById("attendance-edit-break").value=String(Math.round(e.breakSeconds/60)),document.getElementById("attendance-edit-reason").value="",document.getElementById("attendance-edit-dialog")?.showModal())},_=async()=>{const t=n.editingRecord;t&&(await l(`/timecard/records/${encodeURIComponent(S())}/${t.id}`,{method:"PATCH",body:JSON.stringify({startAt:new Date(document.getElementById("attendance-edit-start").value).toISOString(),endAt:new Date(document.getElementById("attendance-edit-end").value).toISOString(),breakSeconds:Number(document.getElementById("attendance-edit-break").value)*60,reason:document.getElementById("attendance-edit-reason").value,recordVersion:t.recordVersion,requestId:crypto.randomUUID()})}),document.getElementById("attendance-edit-dialog")?.close(),y(r().correctionDone),await p())},J=async()=>{const t=document.getElementById("timecard-month");if(t){const e=new Date;t.value=`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}`}document.querySelectorAll("[data-admin-tab]").forEach(e=>{e.addEventListener("click",()=>$(e.dataset.adminTab))}),document.querySelectorAll("[data-refresh]").forEach(e=>{e.addEventListener("click",async()=>{try{await B[e.dataset.refresh]?.(),y(r().refreshed)}catch(a){m(a.message||r().unavailable)}})}),document.getElementById("timecard-filters")?.addEventListener("submit",async e=>{e.preventDefault(),n.recordPage=1,await p().catch(a=>m(a.message))}),document.getElementById("timecard-page-prev")?.addEventListener("click",async()=>{n.recordPage<=1||(n.recordPage-=1,await p().catch(e=>m(e.message)))}),document.getElementById("timecard-page-next")?.addEventListener("click",async()=>{const e=Math.max(1,Math.ceil(n.recordTotal/n.recordPageSize));n.recordPage>=e||(n.recordPage+=1,await p().catch(a=>m(a.message)))}),document.getElementById("admin-services-grid")?.addEventListener("click",e=>{const a=e.target.closest("[data-service-action]");a&&q(a)}),document.getElementById("timecard-records")?.addEventListener("click",e=>{const a=e.target.closest("[data-edit-record]");a&&V(a.dataset.editRecord)}),document.getElementById("service-action-dialog")?.addEventListener("close",async e=>{if(e.target.returnValue==="confirm")try{await F()}catch(a){m(a.message||r().unavailable)}}),document.querySelector("[data-close-dialog]")?.addEventListener("click",()=>{document.getElementById("attendance-edit-dialog")?.close()}),document.getElementById("attendance-edit-form")?.addEventListener("submit",async e=>{e.preventDefault();try{await _()}catch(a){m(a.message||r().unavailable)}}),window.addEventListener("langchange",()=>{A(),T({items:n.records,total:n.recordTotal,page:n.recordPage,pageSize:n.recordPageSize}),$(n.activeTab)});try{n.session=await l("/session");const e=document.getElementById("admin-email");e&&(e.textContent=n.session.email),await O(),await $("overview")}catch(e){console.error("Failed to initialize the administration page",e),m(r().signedInError);const a=document.getElementById("admin-email");a&&(a.textContent=r().unavailable)}};document.addEventListener("DOMContentLoaded",()=>{C(),D(),P({currentProjectId:"admin"}),M(),J();const t=document.getElementById("footer-year");t&&(t.textContent=String(new Date().getFullYear()))});
