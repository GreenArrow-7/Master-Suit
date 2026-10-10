'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { dateProblem, formatTypedDate, parseTypedDate, toDateValue, toTimeValue } from '@/lib/dates';

/**
 * One date field for the whole app: type it, or pick it from the calendar.
 *
 * The field people see takes DD/MM/YYYY (or 8 digits, or YYYY-MM-DD) on every
 * browser and phone; the calendar is the browser's own picker, opened from the
 * button at the end of the field. The form receives YYYY-MM-DD in a hidden input
 * under `name`, exactly what a native date input submitted, so no API changes.
 *
 * Validation is the form's own: the visible field carries `required` and a
 * custom validity message, so a form that submits natively, or calls
 * checkValidity(), stops on an impossible or out-of-range date and says why.
 */
export type DateInputProps = {
  /** Submitted as YYYY-MM-DD in a hidden input. */
  name?: string;
  /** Goes on the typed field, so <label htmlFor> reaches it. */
  id?: string;
  /** Controlled value, YYYY-MM-DD ('' for none). */
  value?: string;
  /** Uncontrolled starting value: YYYY-MM-DD, a Date, or an ISO timestamp. */
  defaultValue?: Date | string | null;
  /** Called with YYYY-MM-DD, or '' while the field is empty or not yet a real date. */
  onChange?: (value: string) => void;
  /** YYYY-MM-DD bounds; the calendar greys out days beyond them. */
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  /** Extra classes for the typed field. */
  className?: string;
  style?: CSSProperties;
};

export default function DateInput(props: DateInputProps) {
  const { min, max, required, disabled } = props;
  const controlled = props.value !== undefined;
  const start = controlled ? (props.value ?? '') : toDateValue(props.defaultValue);

  const [iso, setIso] = useState(start);
  const [text, setText] = useState(formatTypedDate(start));
  // The last value this field reported, so a parent echoing it back is not
  // mistaken for an outside change (which would wipe what is being typed).
  const [seen, setSeen] = useState(start);
  const [shown, setShown] = useState(false);
  const typedRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const messageId = useId();

  // A parent that changes the value itself (a reset, a computed default) wins.
  if (controlled && props.value !== seen) {
    setSeen(props.value ?? '');
    setIso(props.value ?? '');
    setText(formatTypedDate(props.value));
  }

  const problem = dateProblem(text, { required, min, max });
  useEffect(() => {
    typedRef.current?.setCustomValidity(problem ?? '');
  }, [problem]);

  // form.reset() puts an uncontrolled field back to where it started, as it
  // would a native date input; React state would otherwise keep the old date
  // and post it with the next record.
  useEffect(() => {
    const form = typedRef.current?.form;
    if (controlled || !form) return;
    const reset = () => {
      setIso(start);
      setText(formatTypedDate(start));
      setShown(false);
    };
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [controlled, start]);

  function report(next: string) {
    setIso(next);
    setSeen(next);
    props.onChange?.(next);
  }

  function typed(nextText: string) {
    setText(nextText);
    const parsed = parseTypedDate(nextText);
    report(parsed && !dateProblem(nextText, { min, max }) ? parsed : '');
  }

  function picked(next: string) {
    setText(formatTypedDate(next));
    setShown(true);
    report(next);
  }

  function openCalendar() {
    try {
      pickerRef.current?.showPicker();
    } catch {
      // Browsers without showPicker open the picker on the tap itself.
    }
  }

  const visibleProblem = shown && text.trim() ? problem : null;
  const describedBy =
    [props['aria-describedby'], visibleProblem ? messageId : null].filter(Boolean).join(' ') || undefined;

  return (
    <span className="lf-date" style={props.style}>
      <span className="lf-date__box">
        <input
          ref={typedRef}
          id={props.id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          // Its own width is ten characters (DD/MM/YYYY); in a card it fills the row.
          size={12}
          placeholder="DD/MM/YYYY"
          className={['lf-input', 'lf-date__text', props.className].filter(Boolean).join(' ')}
          value={text}
          required={required}
          disabled={disabled}
          aria-label={props['aria-label']}
          aria-invalid={visibleProblem ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => typed(event.target.value)}
          onBlur={() => {
            setShown(true);
            // Tidy a real date into the one format the app shows.
            const parsed = parseTypedDate(text);
            if (parsed) setText(formatTypedDate(parsed));
          }}
          onInvalid={() => setShown(true)}
        />
        <span className="lf-date__pick">
          <button
            type="button"
            className="lf-date__button"
            aria-label="Choose a date from the calendar"
            disabled={disabled}
            onClick={openCalendar}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M5 1a1 1 0 0 1 1 1v1h4V2a1 1 0 1 1 2 0v1h1.5A1.5 1.5 0 0 1 15 4.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5v-9A1.5 1.5 0 0 1 2.5 3H4V2a1 1 0 0 1 1-1Zm8 6H3v6h10V7Z"
              />
            </svg>
          </button>
          {/* The browser's own calendar, laid over the button: a tap on a phone
              opens it natively, a click elsewhere goes through showPicker. */}
          <input
            ref={pickerRef}
            type="date"
            className="lf-date__native"
            tabIndex={-1}
            aria-hidden="true"
            value={iso}
            min={min}
            max={max}
            disabled={disabled}
            onClick={openCalendar}
            onChange={(event) => picked(event.target.value)}
          />
        </span>
      </span>
      {props.name && <input type="hidden" name={props.name} value={iso} />}
      {visibleProblem && (
        <span id={messageId} className="lf-date__message" role="alert">
          {visibleProblem}
        </span>
      )}
    </span>
  );
}

/**
 * A date and a time together, submitted as "YYYY-MM-DDTHH:mm" in the hidden
 * input — exactly what a datetime-local input sent, so no API changes. The time
 * is the browser's own time field.
 */
export function DateTimeInput({
  name,
  id,
  value,
  defaultValue,
  onChange,
  min,
  max,
  required,
  disabled,
  'aria-label': ariaLabel,
}: {
  name?: string;
  id?: string;
  /** Controlled value, "YYYY-MM-DDTHH:mm" ('' for none). */
  value?: string;
  /** Uncontrolled start: "YYYY-MM-DDTHH:mm", a Date or an ISO timestamp. */
  defaultValue?: Date | string | null;
  /** Called with "YYYY-MM-DDTHH:mm", or '' until both parts are filled. */
  onChange?: (value: string) => void;
  /** "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"; only the date part bounds the calendar. */
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const controlled = value !== undefined;
  const source = controlled ? value : defaultValue;
  const [date, setDate] = useState(toDateValue(source));
  const [time, setTime] = useState(toTimeValue(source));
  const [seen, setSeen] = useState(controlled ? value : '');
  const combined = date && time ? `${date}T${time}` : '';

  if (controlled && value !== seen) {
    setSeen(value ?? '');
    setDate(toDateValue(value));
    setTime(toTimeValue(value));
  }

  // Back to the start on form.reset(), like DateInput.
  const timeRef = useRef<HTMLInputElement>(null);
  const startDate = controlled ? '' : toDateValue(defaultValue);
  const startTime = controlled ? '' : toTimeValue(defaultValue);
  useEffect(() => {
    const form = timeRef.current?.form;
    if (controlled || !form) return;
    const reset = () => {
      setDate(startDate);
      setTime(startTime);
    };
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [controlled, startDate, startTime]);

  function report(nextDate: string, nextTime: string) {
    const next = nextDate && nextTime ? `${nextDate}T${nextTime}` : '';
    setSeen(next);
    onChange?.(next);
  }

  return (
    <span className="lf-datetime">
      <DateInput
        id={id}
        value={date}
        min={min?.slice(0, 10)}
        max={max?.slice(0, 10)}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel}, date` : undefined}
        onChange={(next) => {
          setDate(next);
          report(next, time);
        }}
      />
      <input
        ref={timeRef}
        type="time"
        className="lf-input lf-datetime__time"
        value={time}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel}, time` : 'Time'}
        onChange={(event) => {
          setTime(event.target.value);
          report(date, event.target.value);
        }}
      />
      {name && <input type="hidden" name={name} value={combined} />}
    </span>
  );
}
