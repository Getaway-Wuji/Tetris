import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import SquishSwitch from '../react-bits/SquishSwitch';
import type { Action, Difficulty, useTetris } from './engine';
import { actions, dateLabel, difficulties, formatTime, keyLabel, numberLabel } from './labels';

type Game = ReturnType<typeof useTetris>;

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return <dialog className="plush-dialog" ref={ref} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.currentTarget === event.target) close(); }}>
    <div className="plush-dialog-inner">
      <header className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="btn plush-button icon-button" aria-label="关闭弹窗" autoFocus onClick={close}><X /></button>
      </header>
      {children}
    </div>
  </dialog>;
}

const qualityLabels = { auto: '自动', high: '高', medium: '中', low: '低' } as const;
const switches = [['acceleratedFall', '重力加速下落'], ['sound', '游戏音效'], ['reducedMotion', '减少动态效果'], ['ghost', '显示落点预览']] as const;

export function DifficultySelect({ value, onChange, label = '难度', className }: {
  value: Difficulty; onChange: (difficulty: Difficulty) => void; label?: string; className: string;
}) {
  return <label className={className}>{label}
    <select className="select difficulty-select" value={value} onChange={event => onChange(event.currentTarget.value as Difficulty)}>
      {Object.entries(difficulties).map(([difficulty, name]) => <option key={difficulty} value={difficulty}>{name}</option>)}
    </select>
  </label>;
}

function Settings({ game }: { game: Game }) {
  const { settings, patchSettings, resetBindings, rebind } = game;
  const [editing, setEditing] = useState<Action | null>(null);
  const [message, setMessage] = useState('');

  return <>
    <div className="settings-fields">
      <DifficultySelect className="settings-row" label={game.board ? '下局难度' : '难度'} value={settings.difficulty}
        onChange={difficulty => patchSettings({ difficulty })} />
      <label className="settings-row">画质
        <select className="select quality-select" value={settings.quality}
          onChange={event => patchSettings({ quality: event.currentTarget.value as typeof settings.quality })}>
          {Object.entries(qualityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {switches.map(([key, label]) => <div className="settings-row" key={key}>
        <span>{label}</span>
        <SquishSwitch ariaLabel={label} checked={settings[key]} onChange={value => patchSettings({ [key]: value })}
          reducedMotion={settings.reducedMotion} trackColor="#ddd8e6" trackOnColor="#c9b9ed"
          thumbColor="#fffdf7" thumbOnColor="#534273" width={52} height={28} />
      </div>)}
      <label className="settings-row">音量
        <input className="range volume-range" type="range" min="0" max="100" value={Math.round(settings.volume * 100)}
          disabled={!settings.sound} onChange={event => patchSettings({ volume: Number(event.currentTarget.value) / 100 })} />
      </label>
    </div>
    <h3 className="dialog-subheading">按键设置</h3>
    <p className="muted">选择一个键位，再按下想使用的键。按 Esc 取消。</p>
    <div className="settings-fields">
      {actions.map(([action, label]) => <div key={action} className="settings-row">
        <span>{label}</span>
        <button type="button" className="btn plush-button binding-button" aria-label={`更改${label}按键`}
          onClick={() => { setEditing(action); setMessage(''); }} onBlur={() => setEditing(null)}
          onKeyDown={event => {
            if (editing !== action) return;
            if (event.code === 'Tab') { setEditing(null); return; }
            event.preventDefault();
            event.stopPropagation();
            if (event.repeat) return;
            if (event.code === 'Escape') { setEditing(null); return; }
            if (rebind(action, [event.code])) {
              setMessage(`${label}已设为 ${keyLabel(event.code)}。`);
            } else {
              setMessage(`${keyLabel(event.code)} 已被占用或无法绑定。`);
            }
            setEditing(null);
          }}>{editing === action ? '按下新键' : settings.bindings[action].map(keyLabel).filter((key, i, list) => list.indexOf(key) === i).join(' / ')}</button>
      </div>)}
    </div>
    <p className="settings-message" role="status">{message}</p>
    <button type="button" className="btn plush-button" onClick={() => { resetBindings(); setMessage('已恢复默认键位。'); }}>恢复默认键位</button>
  </>;
}

function Help({ game }: { game: Game }) {
  return <>
    <p className="muted">移动和旋转方块，填满一整行即可消除。开局可选休闲、标准或挑战。每消除 10 行升一级，方块会落得更快。</p>
    <p className="muted">活动方块贴住已落定的方块时，横移、旋转、降落键和暂存都暂停生效。沿侧面自然滑落并离开接触后，可以继续操作。</p>
    <dl className="help-keys">
      {actions.map(([action, label]) => <div key={action}><dt>{label}</dt>
        <dd>{[...new Set(game.settings.bindings[action].map(keyLabel))].map(key => <kbd key={key}>{key}</kbd>)}</dd>
      </div>)}
    </dl>
    <h3 className="dialog-subheading">计分与暂存</h3>
    <p className="muted">同时消除 1、2、3、4 行分别得 100、300、500、800 分，再乘以本次消行前的等级。软降每格加 1 分，直接落到底每格加 2 分。每个方块落定前可暂存一次。</p>
    <p className="muted">方块无法生成，或消行结算后堆叠仍超出棋盘顶部，本局结束。</p>
  </>;
}

function History({ game }: { game: Game }) {
  return <>
    <p className="history-best">本地最高分 <strong>{numberLabel.format(game.bestScore)}</strong></p>
    {game.records.length ? <ol className="history-list">
      {game.records.map(record => <li key={record.id}>
        <div><strong>{numberLabel.format(record.score)}</strong> 分 <span>{record.lines} 行 · 等级 {record.level} · {formatTime(record.elapsedMs)}</span></div>
        <time dateTime={record.completedAt}>{dateLabel.format(new Date(record.completedAt))}</time>
      </li>)}
    </ol> : <p className="muted">完成一局后，成绩会保存在此浏览器。</p>}
  </>;
}

export function GameDialog({ game }: { game: Game }) {
  if (!game.overlay) return null;
  const panels = { settings: ['游戏设置', Settings], help: ['玩法与按键', Help], history: ['对局记录', History] } as const;
  const [title, Panel] = panels[game.overlay];
  return <Dialog key={game.overlay} title={title} close={game.closeOverlay}><Panel game={game} /></Dialog>;
}
