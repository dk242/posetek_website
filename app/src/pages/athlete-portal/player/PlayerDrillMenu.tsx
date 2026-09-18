import { useEffect, useRef, useState } from 'react';
import { DRILLS } from '../lib/drills';
import { NativeIcon } from './native-ui';
import { NATIVE_DRILL_ICONS } from './native-results';
import './native-results.css';

export default function PlayerDrillMenu({ onSelect }: { onSelect: (key: string) => void }) {
  const [settings, setSettings] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (settings) dialog.current?.showModal(); else dialog.current?.close(); }, [settings]);
  return <section className="native-drill-menu">
    <header className="native-drill-intro"><div><h1>what would you like to work on?</h1><p>Choose a drill path to review your progress.</p></div><span className="native-icon-disc"><NativeIcon name="figure.soccer" size={28} /></span></header>
    <div className="native-drill-grid">{DRILLS.map(drill => <button className="native-drill-choice" key={drill.key} onClick={() => onSelect(drill.key)}><span className="native-drill-choice-top"><span className="native-icon-disc"><NativeIcon name={NATIVE_DRILL_ICONS[drill.key]} size={20} /></span><strong>{drill.label}</strong><NativeIcon name="chevron.right" size={12} /></span><span className="native-drill-choice-line" aria-hidden="true"><i /><i /></span></button>)}
      <button className="native-drill-choice" onClick={() => setSettings(true)}><span className="native-drill-choice-top"><span className="native-icon-disc"><NativeIcon name="gearshape.fill" size={20} /></span><strong>Drill Settings</strong><NativeIcon name="chevron.right" size={12} /></span><span className="native-drill-choice-line" aria-hidden="true"><i /><i /></span></button>
    </div>
    <p className="native-platform-note"><NativeIcon name="iphone" size={16} /> Record and process new tests in the PoseTek app. Your saved sessions appear here.</p>
    <dialog ref={dialog} className="native-drill-settings" aria-labelledby="native-drill-settings-title" onCancel={() => setSettings(false)} onClose={() => setSettings(false)}><header><h2 id="native-drill-settings-title">Drill Settings</h2><button aria-label="Close drill settings" onClick={() => setSettings(false)}><NativeIcon name="xmark" size={18} /></button></header><p>Recording settings belong to the PoseTek mobile app.</p><div><NativeIcon name="video.fill" /><span><strong>Recording and calibration</strong><small>Set up the camera and start new tests in the app.</small></span></div><div><NativeIcon name="speaker.wave.2.fill" /><span><strong>Spoken rep results</strong><small>Choose result announcements in the app’s Drill Settings.</small></span></div><p className="muted-copy">Your saved videos and measured results are available to review on the website.</p><button className="hub-secondary" onClick={() => setSettings(false)}>Done</button></dialog>
  </section>;
}
