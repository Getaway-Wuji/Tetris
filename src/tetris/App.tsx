import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, ChevronRight, Footprints, History,
  Keyboard, Layers3, Pause, Play, RotateCcw, RotateCw, Settings2, Shapes, Trophy, Volume2, VolumeX,
} from 'lucide-react';
import { useTetris } from './engine';
import type { Action } from './engine';
import { frameFromSnapshot, PiecePreview, PlushBoard } from './render';
import { CLEAR_CONTACT_MS, flightDuration } from './render/landing';
import { DifficultySelect, GameDialog } from './Dialogs';
import { actions, difficulties, formatTime, keyLabel, numberLabel } from './labels';

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const subscribeMotion = (notify: () => void) => {
  motionQuery.addEventListener('change', notify);
  return () => motionQuery.removeEventListener('change', notify);
};
const systemMotion = () => motionQuery.matches;

const pieces = ['', 'I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const touchControls = [
  ['hold', '暂存', Layers3], ['counterClockwise', '逆时针旋转', RotateCcw],
  ['clockwise', '顺时针旋转', RotateCw], ['pause', '暂停／继续', Pause],
  ['left', '左移', ArrowLeft], ['hardDrop', '落到底', ArrowDownToLine],
  ['right', '右移', ArrowRight], ['softDrop', '软降', Footprints],
] as const satisfies ReadonlyArray<readonly [Action, string, typeof Pause]>;

export function App() {
  const game = useTetris();
  const { board, phase, settings, bestScore, eventId, events, fallClock } = game;
  const osReducedMotion = useSyncExternalStore(subscribeMotion, systemMotion);
  const reducedMotion = settings.reducedMotion || osReducedMotion;
  const boardRef = useRef<HTMLDivElement>(null);
  const dialogWasOpen = useRef(false);
  const frame = useMemo(() => frameFromSnapshot(board, eventId, events, fallClock), [board, events, eventId, fallClock]);
  const next = board?.next ?? [0, 0, 0, 0, 0];
  const canAct = phase === 'running' && !game.overlay;
  const holdLabel = !board ? '等待开局' : board.canHold ? (board.hold ? '可以交换' : '可以暂存') : '暂存不可用';
  const play = (start: () => void) => {
    start();
    boardRef.current?.focus({ preventScroll: true });
  };
  const status = phase === 'loading' ? '加载游戏中' : phase === 'paused' ? '已暂停' : phase === 'over' ? '本局结束' : phase === 'running' ? '游戏中' : phase === 'error' ? '加载失败' : '等待开局';
  const lastClear = events.find(event => event.type === 'clear');
  const lastLevel = events.find(event => event.type === 'level');
  const lastLock = events.find(event => event.type === 'lock');

  useEffect(() => {
    if (dialogWasOpen.current && !game.overlay && phase === 'running') boardRef.current?.focus({ preventScroll: true });
    dialogWasOpen.current = Boolean(game.overlay);
  }, [game.overlay, phase]);

  return <div className="plush-app" data-phase={phase} data-motion={reducedMotion ? 'reduced' : 'full'}>
    <a className="skip-link" href="#playfield">跳到棋盘</a>
    <header className="topbar">
      <div className="topbar-inner">
        <a className="back-link" href="https://game.grace-spring.top/"><ArrowLeft /><span>返回游戏大厅</span></a>
        <nav className="top-actions" aria-label="游戏选项">
          <button type="button" className="btn plush-button icon-button sound-button" aria-label={settings.sound ? '关闭音效' : '开启音效'}
            onClick={() => {
              game.patchSettings({ sound: !settings.sound });
              if (canAct) boardRef.current?.focus({ preventScroll: true });
            }}>{settings.sound ? <Volume2 /> : <VolumeX />}</button>
          <button type="button" className="btn plush-button icon-button" aria-label="游戏设置" onClick={() => game.openOverlay('settings')}><Settings2 /></button>
          <button type="button" className="btn plush-button pause-button" disabled={phase !== 'running' && phase !== 'paused'}
            aria-label={phase === 'paused' ? '继续游戏' : '暂停游戏'}
            onClick={() => phase === 'paused' ? play(game.resume) : game.pause()}>
            {phase === 'paused' ? <Play /> : <Pause />}<span>{phase === 'paused' ? '继续' : '暂停'}</span>
          </button>
        </nav>
      </div>
    </header>

    <main className="game-main">
      <div className="masthead">
        <div className="brand-line"><span className="brand-tiles" aria-hidden="true"><i /><i /><i /><i /></span><span lang="en">PUFF STACK</span></div>
        <h1>毛绒俄罗斯方块</h1>
        <span className="mast-stitch mast-stitch-left" aria-hidden="true">✳</span>
        <span className="mast-stitch mast-stitch-right" aria-hidden="true">✦</span>
      </div>

      <div className="game-grid">
        <section className="console-panel hold-panel" aria-labelledby="hold-title" data-available={board?.canHold ?? false}>
          <div className="panel-heading"><Layers3 /><h2 id="hold-title">暂存</h2><kbd>{keyLabel(settings.bindings.hold[0])}</kbd></div>
          <div className="hold-preview" key={board?.hold || 'empty'} aria-label={board?.hold ? `已暂存 ${pieces[board.hold]} 方块` : '暂无暂存方块'}>
            {board?.hold ? <PiecePreview kind={board.hold} /> : <span className="hold-glyph" aria-hidden="true"><i /><i /><i /><i /></span>}
          </div>
          <div className="hold-label">{holdLabel}</div>
        </section>

        <section className="console-panel keys-panel" aria-labelledby="keys-title">
          <div className="panel-heading"><Keyboard /><h2 id="keys-title">键盘操作</h2></div>
          <dl className="keys-list">
            <div><dt>左右移动</dt><dd><kbd>{keyLabel(settings.bindings.left[0])}</kbd><kbd>{keyLabel(settings.bindings.right[0])}</kbd></dd></div>
            {actions.slice(2).map(([action, label]) => <div key={action}><dt>{label}</dt><dd><kbd>{keyLabel(settings.bindings[action][0])}</kbd></dd></div>)}
          </dl>
          <button type="button" className="panel-link" onClick={() => game.openOverlay('help')}><BookOpen />玩法与按键<ChevronRight /></button>
        </section>

        <section className="board-column" aria-label="游戏区">
          <div className="board-cabinet">
            <div className="cabinet-heading"><span><span className="status-dot" />{status}{board?.difficulty ? ` · ${difficulties[board.difficulty]}` : ''}</span><span className="cabinet-grid-label">10 × 20</span></div>
            <div className="playfield" id="playfield" ref={boardRef} tabIndex={-1} aria-label="俄罗斯方块棋盘">
              <PlushBoard frame={frame} gameId={game.gameId} quality={settings.quality} reducedMotion={reducedMotion} ghost={settings.ghost} />
              {phase === 'running' && lastClear && !reducedMotion && <div key={`clear-${eventId}`} className="board-feedback"
                style={{ animationDelay: `${flightDuration(lastLock?.drop ?? 0) + CLEAR_CONTACT_MS}ms` }} aria-hidden="true">
                {lastLevel ? `升级 · 等级 ${lastLevel.level}` : `消除 ${lastClear.rows.length} 行`}
              </div>}
              {phase !== 'running' && <div className="board-veil">
                <div className="board-prompt" role="region" aria-label={status}>
                  <span className="prompt-mark" aria-hidden="true">{phase === 'paused' ? <Pause /> : phase === 'over' ? <Trophy /> : <Shapes />}</span>
                  {phase === 'loading' && <h2 role="status">加载游戏中…</h2>}
                  {phase === 'error' && <><h2>游戏加载失败</h2><p role="alert">{game.error ?? '请重试加载。'}</p>
                    <button type="button" className="btn plush-button primary-button" onClick={game.retry}>重试加载</button></>}
                  {phase === 'ready' && <><h2>经典无尽模式</h2>
                    <DifficultySelect className="prompt-difficulty" value={settings.difficulty}
                      onChange={difficulty => game.patchSettings({ difficulty })} />
                    <button type="button" className="btn plush-button primary-button" onClick={() => play(game.start)}><Play />开始游戏</button></>}
                  {phase === 'paused' && <><h2>游戏暂停</h2><p>棋盘和计时已保留。</p>
                    <button type="button" className="btn plush-button primary-button" onClick={() => play(game.resume)}><Play />继续游戏</button>
                    <button type="button" className="prompt-link" onClick={() => play(game.start)}>开始新局</button>
                    <a className="prompt-link" href="https://game.grace-spring.top/">返回游戏大厅</a></>}
                  {phase === 'over' && <><h2>本局结束</h2><strong className="result-score">{numberLabel.format(board?.score ?? 0)}</strong>
                    <p>{board?.lines ?? 0} 行 · 等级 {board?.level ?? 1} · {formatTime(board?.elapsedMs ?? 0)}<br />本地最高分 {numberLabel.format(bestScore)}</p>
                    <button type="button" className="btn plush-button primary-button" onClick={() => play(game.start)}><RotateCcw />再来一局</button>
                    <button type="button" className="prompt-link" onClick={() => game.openOverlay('history')}>查看记录</button>
                    <a className="prompt-link" href="https://game.grace-spring.top/">返回游戏大厅</a></>}
                </div>
              </div>}
            </div>
            <div className="cabinet-footer" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          </div>
        </section>

        <section className="console-panel score-panel" aria-labelledby="score-title">
          <div className="panel-heading"><Trophy /><h2 id="score-title">当前分数</h2></div>
          <strong className="score-number" data-testid="tetris-score">{numberLabel.format(board?.score ?? 0)}</strong>
          <div className="best-score"><span>本地最高分</span><strong>{numberLabel.format(bestScore)}</strong></div>
          <dl className="game-stats">
            <div><dt>等级</dt><dd data-testid="tetris-level">{String(board?.level ?? 1).padStart(2, '0')}</dd></div>
            <div><dt>消行</dt><dd data-testid="tetris-lines">{String(board?.lines ?? 0).padStart(2, '0')}</dd></div>
            <div><dt>用时</dt><dd data-testid="tetris-time">{formatTime(board?.elapsedMs ?? 0)}</dd></div>
          </dl>
        </section>

        <section className="console-panel next-panel" aria-labelledby="next-title">
          <div className="panel-heading"><Shapes /><h2 id="next-title">接下来</h2></div>
          <ol className="next-pieces">
            {next.map((kind, position) => <li key={position} aria-label={`第 ${position + 1} 个${kind ? `，${pieces[kind]} 方块` : ''}`}>
              {kind ? <PiecePreview kind={kind} /> : <span className="empty-next" aria-hidden="true">·</span>}
            </li>)}
          </ol>
        </section>

        <section className="touch-pad" aria-label="触摸操作">
          {touchControls.map(([action, label, Icon]) => <button key={action} type="button"
            className={`btn plush-button touch-key touch-${action}`} aria-label={label}
            disabled={action === 'pause' ? phase !== 'running' && phase !== 'paused' : !canAct || (action === 'hold' && !board?.canHold)}
            {...game.touchHandlers(action)}>
            {action === 'pause' && phase === 'paused' ? <Play /> : <Icon />}
            <span>{action === 'clockwise' ? '顺转' : action === 'counterClockwise' ? '逆转' : action === 'pause' ? phase === 'paused' ? '继续' : '暂停' : label}</span>
          </button>)}
        </section>
      </div>

      <footer className="game-footer">
        <span className="storage-note">{game.storageAvailable ? '进度保存在此浏览器' : '此浏览器暂时无法保存进度'}</span>
        <button type="button" className="footer-link mobile-help" onClick={() => game.openOverlay('help')}><BookOpen />玩法</button>
        <button type="button" className="footer-link" onClick={() => game.openOverlay('history')}><History />对局记录</button>
      </footer>
    </main>
    <GameDialog game={game} />
  </div>;
}
