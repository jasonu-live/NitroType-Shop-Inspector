// ==UserScript==
// @name         NitroType Shop Inspector (All-in-One: Minimal, Full, Auto-Refresh)
// @namespace    https://example.com/
// @version      3.0
// @description  Show current & upcoming shop items on NitroType with switchable Minimal / Full UI / Auto-Refresh modes (uses logged-in session cookies).
// @author       You
// @match        https://www.nitrotype.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    ////////////////////////////////////////////////////////////////
    // CONFIGURATION
    ////////////////////////////////////////////////////////////////
    const ENDPOINTS = [
        '/api/v2/bootstrap',
        '/api/bootstrap',
        '/api/v2/',
        '/api/'
    ];
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes for auto-refresh

    ////////////////////////////////////////////////////////////////
    // CORE FETCH
    ////////////////////////////////////////////////////////////////
    async function fetchJsonSameOrigin(path) {
        const resp = await fetch(path, { credentials: 'include' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
    }

    async function getBootstrap() {
        for (const ep of ENDPOINTS) {
            try {
                const json = await fetchJsonSameOrigin(ep);
                if (json && Object.keys(json).length) return { data: json, usedUrl: ep };
            } catch (_) {}
        }
        return { data: null, usedUrl: null };
    }

    function normalizeBootstrap(raw) {
        if (!raw) return {};
        if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0]) && raw[0].length === 2) {
            const obj = {};
            raw.forEach(([k, v]) => obj[k] = v);
            return obj;
        }
        const possibleKeys = ['BOOTSTRAP','bootstrap','SHOP','shop','data','payload'];
        for (const k of possibleKeys) if (k in raw) return raw[k];
        return raw;
    }

    ////////////////////////////////////////////////////////////////
    // DATA EXTRACTION (heuristic)
    ////////////////////////////////////////////////////////////////
    function findShopNodes(root) {
        const results = [];
        const seen = new WeakSet();

        function qualifies(obj) {
            if (!obj || typeof obj !== 'object') return false;
            return ('name' in obj) || ('title' in obj) || ('type' in obj);
        }

        function nodeIsShopArray(arr) {
            if (!Array.isArray(arr) || arr.length === 0) return false;
            return arr.some(x => qualifies(x));
        }

        function walk(obj, path=[]) {
            if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
            seen.add(obj);
            if (Array.isArray(obj)) {
                const p = path.join('.').toLowerCase();
                if (nodeIsShopArray(obj) || p.includes('shop') || p.includes('daily') || p.includes('featured') || p.includes('upcoming')) {
                    results.push({ path: path.join('.'), node: obj });
                }
                obj.forEach((x,i)=>walk(x,path.concat([`[${i}]`])));
            } else {
                for (const k of Object.keys(obj)) {
                    const val = obj[k];
                    const lower = k.toLowerCase();
                    if (Array.isArray(val) && (nodeIsShopArray(val) || lower.includes('shop') || lower.includes('daily') || lower.includes('featured') || lower.includes('upcoming'))) {
                        results.push({ path: path.concat([k]).join('.'), node: val });
                    }
                    if (typeof val === 'object') walk(val,path.concat([k]));
                }
            }
        }
        walk(root);
        return results;
    }

    ////////////////////////////////////////////////////////////////
    // UI CREATION
    ////////////////////////////////////////////////////////////////
    const panel = document.createElement('div');
    panel.id = 'nt-shop-panel';
    panel.style.cssText = `
        position:fixed;right:12px;top:80px;width:400px;max-height:80vh;
        overflow-y:auto;background:rgba(0,0,0,0.9);color:#fff;
        padding:12px;border-radius:10px;z-index:99999;
        font-family:Arial,sans-serif;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,0.6);
    `;
    panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <strong style="font-size:16px">🏎️ NitroType Shop Inspector</strong>
            <div style="display:flex;gap:6px;align-items:center;">
                <select id="nt-mode" style="border:none;border-radius:4px;padding:3px 4px;background:#222;color:#fff;">
                    <option value="minimal">Minimal</option>
                    <option value="full">Full UI</option>
                    <option value="auto">Auto-Refresh</option>
                </select>
                <button id="nt-refresh" title="Refresh" style="cursor:pointer;padding:4px 6px;border:none;border-radius:4px;background:#1e90ff;color:#fff">↻</button>
                <button id="nt-close" title="Close" style="cursor:pointer;padding:4px 6px;border:none;border-radius:4px;background:#444;color:#fff">×</button>
            </div>
        </div>
        <div id="nt-body"><div id="nt-status">Fetching shop data...</div></div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('#nt-close').addEventListener('click',()=>panel.remove());
    panel.querySelector('#nt-refresh').addEventListener('click',()=>loadAndRender(true));

    const modeSelect = panel.querySelector('#nt-mode');

    ////////////////////////////////////////////////////////////////
    // RENDER FUNCTIONS
    ////////////////////////////////////////////////////////////////
    function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]));}

    function renderItemsMinimal(title, items){
        let html = `<div style="margin-bottom:8px;"><strong>${title}</strong><br>`;
        html += items.map(it=>escapeHtml(it.name||it.title||it.id||'')).join(', ');
        html += '</div>';
        return html;
    }

    function renderItemsFull(title, items){
        const html = [`<div style="margin-bottom:14px;"><strong style="font-size:14px">${escapeHtml(title)}</strong>`];
        html.push('<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px;">');
        for (const it of items) {
            const img = it.image || it.img || it.icon || it.imageURL || '';
            const name = it.name || it.title || it.id || '';
            const type = it.type || it.category || '';
            const price = it.price ?? it.cash ?? '';
            html.push(`
                <div style="background:rgba(255,255,255,0.05);padding:6px;border-radius:6px;display:flex;align-items:center;gap:6px;">
                    <img src="${img}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;">
                    <div><strong>${escapeHtml(name)}</strong><div style="font-size:11px;color:#ccc">${escapeHtml(type)}${price!==''?' • '+escapeHtml(String(price)) : ''}</div></div>
                </div>
            `);
        }
        html.push('</div></div>');
        return html.join('');
    }

    function renderData(mode, found){
        const body = panel.querySelector('#nt-body');
        if(!found || !found.length){body.innerHTML='<div id="nt-status">No shop data found.</div>';return;}
        const current=[], upcoming=[];
        for(const entry of found){
            const p=entry.path.toLowerCase();
            if(p.includes('next')||p.includes('upcoming')) upcoming.push(...entry.node);
            else current.push(...entry.node);
        }
        let html='';
        if(mode==='minimal'){
            html+=renderItemsMinimal('Current Shop Items',current);
            html+=renderItemsMinimal('Upcoming Shop Items',upcoming);
        }else{
            html+=renderItemsFull('📦 Current Shop Items',current);
            html+=renderItemsFull('🕒 Upcoming (Next Day) Items',upcoming);
        }
        body.innerHTML=html || '<div id="nt-status">No items found.</div>';
    }

    ////////////////////////////////////////////////////////////////
    // MAIN LOGIC
    ////////////////////////////////////////////////////////////////
    let autoRefreshTimer=null;

    async function loadAndRender(force=false){
        const status = panel.querySelector('#nt-status');
        if(status) status.textContent='Fetching bootstrap...';
        const {data, usedUrl} = await getBootstrap();
        if(!data){
            panel.querySelector('#nt-body').innerHTML='<div id="nt-status">Could not fetch NitroType bootstrap data. Make sure you are logged in.</div>';
            return;
        }
        const normalized = normalizeBootstrap(data);
        const found = findShopNodes(normalized);
        renderData(modeSelect.value==='minimal'?'minimal':'full', found);
        if(status) status.textContent=`Fetched from ${usedUrl || 'unknown source'}`;
    }

    modeSelect.addEventListener('change',()=>{
        if(autoRefreshTimer){clearInterval(autoRefreshTimer);autoRefreshTimer=null;}
        if(modeSelect.value==='auto'){
            loadAndRender();
            autoRefreshTimer=setInterval(loadAndRender,REFRESH_INTERVAL_MS);
        }else{
            loadAndRender();
        }
    });

    ////////////////////////////////////////////////////////////////
    // INITIAL START
    ////////////////////////////////////////////////////////////////
    loadAndRender();
})();
