/**
 * 协同单元格:把表格的原文(raw)放进 Y.Map<"r,c", string>,复用 collab-notes 的同步服务端。
 *  - 本地编辑(含撤销重做)→ 写 Y.Map(origin 'local')
 *  - 远端变更 → sheet.applyRemote(不进撤销栈、不回环)
 *  - 同一格两人同时改:Yjs Map 后写覆盖(last-writer-wins),这里把被覆盖的格高亮几秒提示
 *  - 首次连接:远端有数据以远端为准;远端为空则把本地现有格推上去
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Sheet } from '../engine/sheet';
import { key, parseKey, type Key } from '../engine/types';

export class SheetCollab {
  doc = new Y.Doc();
  provider: WebsocketProvider;
  map: Y.Map<string>;
  private unsub: () => void;
  onRemote?: (keys: Key[]) => void;
  onStatus?: (s: string, peers: number) => void;

  constructor(private sheet: Sheet, url: string, room: string, token: string) {
    this.provider = new WebsocketProvider(url, room, this.doc, { params: { token } });
    this.map = this.doc.getMap<string>('cells');
    this.map.observe(ev => {
      if (ev.transaction.origin === 'local') return;
      const entries: { r: number; c: number; raw: string }[] = []; const keys: Key[] = [];
      ev.changes.keys.forEach((ch, k) => { const [r, c] = parseKey(k); entries.push({ r, c, raw: ch.action === 'delete' ? '' : (this.map.get(k) ?? '') }); keys.push(k); });
      sheet.applyRemote(entries); this.onRemote?.(keys);
    });
    this.unsub = sheet.onEdit(edits => this.doc.transact(() => {
      for (const e of edits) e.after === '' ? this.map.delete(e.key) : this.map.set(e.key, e.after);
    }, 'local'));
    this.provider.on('sync', (synced: boolean) => {
      if (!synced) return;
      if (this.map.size === 0) this.doc.transact(() => { for (const k of sheet.keys()) { const [r, c] = parseKey(k); this.map.set(key(r, c), sheet.getRaw(r, c)); } }, 'local');
      else { const entries = [...this.map.entries()].map(([k, raw]) => { const [r, c] = parseKey(k); return { r, c, raw }; }); sheet.applyRemote(entries); }
    });
    const report = () => this.onStatus?.(this.provider.wsconnected ? 'connected' : 'disconnected', this.provider.awareness.getStates().size);
    this.provider.on('status', report); this.provider.awareness.on('change', report);
    this.provider.awareness.setLocalStateField('user', { name: token.replace(/^[wr]-/, '') });
  }
  destroy() { this.unsub(); this.provider.destroy(); this.doc.destroy(); }
}
