'use client';
import { Children, isValidElement, useContext, type ReactNode, type SelectHTMLAttributes, type ChangeEvent } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { DialogPortalContext } from './Dialog';

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'>;
function options(children: ReactNode): { value: string; label: ReactNode; disabled: boolean }[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return [];
    if (child.type === 'option') return [{ value: String(child.props.value ?? child.props.children ?? ''), label: child.props.children, disabled: !!child.props.disabled }];
    return options(child.props.children);
  });
}
export default function Select({ children, value, defaultValue, onChange, className, disabled, required, name, id, title, ...rest }: Props) {
  const entries = options(children);
  const dialogPortal = useContext(DialogPortalContext);
  const encoded = (item: unknown) => String(item ?? '') || '__empty_option__';
  return <SelectPrimitive.Root value={value === undefined ? undefined : encoded(value)} defaultValue={defaultValue === undefined ? undefined : encoded(defaultValue)} disabled={disabled} required={required} name={name} onValueChange={next => {
    const selected = next === '__empty_option__' ? '' : next;
    onChange?.({ target: { value: selected }, currentTarget: { value: selected } } as ChangeEvent<HTMLSelectElement>);
  }}>
    <SelectPrimitive.Trigger aria-label={rest['aria-label'] || title} aria-labelledby={rest['aria-labelledby']} aria-describedby={rest['aria-describedby']} aria-invalid={rest['aria-invalid']} aria-required={required || rest['aria-required']} id={id} title={title} style={rest.style} className={`ui-select-trigger ${className || ''}`}><SelectPrimitive.Value /><SelectPrimitive.Icon aria-hidden className="ui-select-chevron"><ChevronDown size={14} strokeWidth={1.8} /></SelectPrimitive.Icon></SelectPrimitive.Trigger>
    <SelectPrimitive.Portal container={dialogPortal ?? undefined}><SelectPrimitive.Content position="popper" sideOffset={6} collisionPadding={10} className="ui-select-content"><SelectPrimitive.ScrollUpButton className="ui-select-scroll"><ChevronUp size={14} aria-hidden="true" /></SelectPrimitive.ScrollUpButton><SelectPrimitive.Viewport className="p-1.5">{entries.map(entry => <SelectPrimitive.Item key={encoded(entry.value)} value={encoded(entry.value)} disabled={entry.disabled} className="ui-select-item"><SelectPrimitive.ItemText>{entry.label}</SelectPrimitive.ItemText><SelectPrimitive.ItemIndicator aria-hidden><Check size={14} /></SelectPrimitive.ItemIndicator></SelectPrimitive.Item>)}</SelectPrimitive.Viewport><SelectPrimitive.ScrollDownButton className="ui-select-scroll"><ChevronDown size={14} aria-hidden="true" /></SelectPrimitive.ScrollDownButton></SelectPrimitive.Content></SelectPrimitive.Portal>
  </SelectPrimitive.Root>;
}
