import { useEffect, useRef } from 'react'
import { Info, ShieldCheck, X } from 'lucide-react'

export default function RulesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [open])
  return (
    <dialog
      className="rules-dialog"
      ref={dialog}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      aria-labelledby="rules-title"
    >
      <div className="dialog-heading">
        <span className="section-icon">
          <ShieldCheck size={20} />
        </span>
        <button className="icon-button" aria-label="Close risk rules" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <span className="eyebrow">THE RULES OF THE ROAD</span>
      <h2 id="rules-title">How your route is assessed</h2>
      <p>
        The highest weather risk at a checkpoint wins. Wind uses the greater of sustained wind and
        forecast gusts.
      </p>
      <div className="rules-table-wrap">
        <table className="rules-table">
          <thead>
            <tr>
              <th>Risk</th>
              <th>Wind · mph</th>
              <th>Rain · in/hr</th>
              <th>Snow · in/hr</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <i className="dot risk-bg-0" />
                Low
              </td>
              <td>&lt;25</td>
              <td>&lt;0.10</td>
              <td>&lt;0.5</td>
            </tr>
            <tr>
              <td>
                <i className="dot risk-bg-1" />
                Moderate
              </td>
              <td>25–&lt;35</td>
              <td>0.10–&lt;0.25</td>
              <td>0.5–&lt;1</td>
            </tr>
            <tr>
              <td>
                <i className="dot risk-bg-2" />
                High
              </td>
              <td>35–&lt;45</td>
              <td>0.25–&lt;0.50</td>
              <td>1–&lt;2</td>
            </tr>
            <tr>
              <td>
                <i className="dot risk-bg-3" />
                Severe
              </td>
              <td>45–&lt;55</td>
              <td>0.50–1.00</td>
              <td>2–3</td>
            </tr>
            <tr>
              <td>
                <i className="dot risk-bg-4" />
                No Travel
              </td>
              <td>≥55</td>
              <td>&gt;1.00</td>
              <td>&gt;3</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>Load changes the wind risk</h3>
      <ul>
        <li>Wind ≥55 mph: no travel for any load.</li>
        <li>Wind 45–&lt;55 mph and load &gt;30,000 lb: no travel.</li>
        <li>Wind 35–&lt;45 mph and load &gt;40,000 lb: severe risk.</li>
      </ul>
      <h3>Safety comes first. Time breaks the tie.</h3>
      <p>
        Routes with no-travel checkpoints or missing forecasts are excluded. Remaining routes are
        ranked by severe miles, high miles, distance-weighted average risk, then travel time, in
        that order.
      </p>
      <div className="info-note">
        <Info size={17} />
        <span>
          Each stretch uses the worse risk of its two checkpoints. Shared rain and snow thresholds
          use the higher band. Forecasts are hourly estimates. The map slider explores weather;
          route recommendations always use arrival-time weather.
        </span>
      </div>
      <p className="fine-print">
        Valhalla uses its default truck profile. Cargo weight affects weather risk; it does not
        represent total vehicle weight. ETAs exclude rest breaks and live traffic. Confirm legal
        truck restrictions before driving.
      </p>
    </dialog>
  )
}
