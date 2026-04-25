"use client";

import {
  useId,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

type CommonProps = {
  label?: string;
  hint?: string;
  error?: string;
};

type InputProps = CommonProps & InputHTMLAttributes<HTMLInputElement>;
type TextareaProps = CommonProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Themed text input with optional label, hint and error message. Always renders
 * a min-height that meets the 44px touch-target guideline and sets
 * `font-size:16px` to suppress iOS zoom on focus.
 */
export function Input({
  label,
  hint,
  error,
  id,
  className,
  ...rest
}: InputProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="ui-field">
      {label ? <label htmlFor={fieldId}>{label}</label> : null}
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          error ? `${fieldId}-err` : hint ? `${fieldId}-hint` : undefined
        }
        className={`ui-input${className ? ` ${className}` : ""}`}
        {...rest}
      />
      {error ? (
        <div id={`${fieldId}-err`} className="ui-field-error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div id={`${fieldId}-hint`} className="ui-field-hint">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Themed multi-line input that mirrors {@link Input}'s API. Useful for feedback
 * bodies and similar long-form fields.
 */
export function Textarea({
  label,
  hint,
  error,
  id,
  className,
  ...rest
}: TextareaProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="ui-field">
      {label ? <label htmlFor={fieldId}>{label}</label> : null}
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          error ? `${fieldId}-err` : hint ? `${fieldId}-hint` : undefined
        }
        className={`ui-textarea${className ? ` ${className}` : ""}`}
        {...rest}
      />
      {error ? (
        <div id={`${fieldId}-err`} className="ui-field-error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div id={`${fieldId}-hint`} className="ui-field-hint">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
