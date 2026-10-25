/** Scoped theme-aware CSS for native DSH Desktop/Web shell. */
export const styles = String.raw`
.gq-root{position:fixed;inset:max(48px,env(titlebar-area-height,0px)) 0 0;z-index:1100;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#101216);color:var(--dsw-alias-label-primary,#f0f0f0);font:14px system-ui,sans-serif}
.gq-root *{box-sizing:border-box}.gq-root button,.gq-root input,.gq-root select,.gq-root textarea,.gq-side{font:inherit;color:inherit}
.gq-root button{border:1px solid var(--dsw-alias-border-l2,#7775);border-radius:7px;background:var(--dsw-alias-bg-layer-2,#333);padding:7px 10px;cursor:pointer}
.gq-root button:hover{filter:brightness(1.13)}.gq-root button:disabled{opacity:.35;cursor:not-allowed}
.gq-root input,.gq-root select,.gq-root textarea{border:1px solid var(--dsw-alias-border-l2,#7775);border-radius:7px;background:var(--dsw-specific-input-major,#222);padding:8px;width:100%}
.gq-root :focus-visible,.gq-side:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#729ffd);outline-offset:2px}
.gq-head{display:flex;flex-wrap:wrap;flex-shrink:0;justify-content:space-between;align-items:center;gap:15px;border-bottom:1px solid var(--dsw-alias-border-l1,#7774);padding:17px 22px}
.gq-head h1{font-size:21px;margin:0}.gq-head span{font-size:12px;color:var(--dsw-alias-label-secondary,#aaa)}
.gq-head .gq-sync{margin-left:10px}
.gq-actions{display:flex;flex-wrap:wrap;gap:8px}.gq-root button.gq-primary{background:#245fc7!important;color:#fff!important;border-color:#245fc7}
.gq-root button.gq-primary:hover:not(:disabled){background:#1d4fa8!important;filter:none}
.gq-root button.gq-primary:disabled{background:#414956!important;color:#d9dee7!important;border-color:#596270;opacity:1;cursor:not-allowed}
.gq-warn{border-color:var(--dsw-alias-state-warn-primary,#e99a3b)!important}
.gq-notes{padding:12px 22px;font-size:12px;line-height:1.8;color:var(--dsw-alias-label-secondary,#bbb);border-bottom:1px solid var(--dsw-alias-border-l1,#7774)}
.gq-error{margin:8px 22px;padding:10px;border:1px solid var(--dsw-alias-state-error-primary,#f77);border-radius:7px;color:var(--dsw-alias-state-error-primary,#f77)}
.gq-notice{margin:8px 22px;padding:10px;border:1px solid var(--dsw-alias-border-l2,#7775);border-radius:7px;font-size:12px;color:var(--dsw-alias-label-primary,#ddd)}
.gq-list{overflow:auto;flex:1;min-height:0;padding:16px 22px}.gq-empty{margin:70px auto;text-align:center;max-width:600px;color:var(--dsw-alias-label-secondary,#aaa)}
.gq-task{border:1px solid var(--dsw-alias-border-l2,#7775);border-radius:10px;margin:0 0 11px;padding:13px 15px;background:var(--dsw-alias-bg-layer-1,#222)}
.gq-task[data-status=running],.gq-task[data-status=starting]{border-left:4px solid var(--dsw-alias-brand-primary,#6ac)}
.gq-task[data-status=blocked],.gq-task[data-status=failed]{border-left:4px solid var(--dsw-alias-state-error-primary,#d65)}
.gq-task-top{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.gq-order{font-weight:750;color:var(--dsw-alias-label-secondary,#aaa);width:20px}
.gq-desc{display:flex;flex:1;flex-direction:column;gap:3px;min-width:150px}.gq-desc strong{font-size:14px}.gq-desc small{font-size:11px;color:var(--dsw-alias-label-secondary,#aaa)}
.gq-pill{font-size:11px;padding:4px 7px;background:var(--dsw-alias-bg-layer-3,#444);border-radius:6px}.gq-pill[data-status=completed]{color:var(--dsw-alias-state-success-primary,#7d9)}
.gq-prompt{margin:10px 0;max-height:92px;overflow:auto;white-space:pre-wrap;color:var(--dsw-alias-label-secondary,#bbb);font-size:12px}
.gq-detail{font-size:12px;color:var(--dsw-alias-state-warn-label,#dc9)}.gq-task-controls{display:flex;flex-wrap:wrap;gap:7px}
.gq-task-controls button{font-size:12px}.gq-side{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:36px;width:100%;margin:4px 0;box-sizing:border-box;padding:0 14px;border:0;border-radius:999px;background:none;color:inherit;font:inherit;font-size:14px;line-height:20px;cursor:pointer;transition:background-color .12s ease}
.gq-side:hover{background:rgba(127,127,127,.14)}
.gq-side:active{transform:scale(.96)}
.gq-modal-backdrop{position:absolute;inset:0;z-index:1200;display:grid;place-items:center;padding:20px;background:#0009}.gq-modal{display:flex;flex-direction:column;gap:13px;width:min(600px,100%);max-height:100%;overflow:auto;border-radius:12px;border:1px solid var(--dsw-alias-border-l2,#7775);padding:20px;background:var(--dsw-alias-bg-layer-1,#222)}
.gq-modal h2{margin:0}.gq-modal label{font-size:12px;display:flex;flex-direction:column;gap:5px}.gq-modal label.gq-check{flex-direction:row;align-items:center}.gq-check input{width:auto}.gq-modal textarea{resize:vertical}.gq-modal p{font-size:11px;color:var(--dsw-alias-label-secondary,#bbb)}.gq-modal footer{display:flex;justify-content:flex-end;gap:8px}
.gq-filters{display:flex;gap:8px;flex-wrap:wrap;padding:10px 22px;border-bottom:1px solid var(--dsw-alias-border-l1,#7774)}
.gq-filters button[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary,#729ffd);font-weight:700}
.gq-history{margin-top:10px;padding:10px;border-top:1px solid var(--dsw-alias-border-l1,#7774);display:flex;flex-direction:column;gap:8px}
.gq-history-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:12px}
.gq-history-row span{overflow-wrap:anywhere}
.gq-external{margin-top:14px;padding:12px 15px;border:1px solid var(--dsw-alias-border-l2,#7775);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#222)}
.gq-external h2{margin:0 0 6px;font-size:14px}
.gq-external-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:12px;margin-top:8px}
.gq-external-row span{overflow-wrap:anywhere}
.gq-external-row button{font-size:12px}
.gq-inspect{margin-top:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#7775);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#222);display:flex;flex-direction:column;gap:6px}
.gq-inspect-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.gq-inspect-actions button{font-size:12px}
.gq-root button.gq-link{border:0;background:none;padding:0;text-decoration:underline;font-size:inherit;color:inherit;cursor:pointer}
.gq-more,.gq-task-details{margin-top:8px}
.gq-more>summary,.gq-task-details>summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary,#aaa)}
.gq-more-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:6px}
.gq-more-actions button{font-size:12px}
.gq-task-details .gq-detail{margin:4px 0;overflow-wrap:anywhere}
.gq-help{margin-top:4px}.gq-help summary{cursor:pointer}
@media (max-width:720px){.gq-head{padding:12px 14px}.gq-notes,.gq-filters{padding-left:14px;padding-right:14px}.gq-list{padding:12px 14px}.gq-task-controls button{min-height:36px}}
`
