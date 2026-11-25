'use client';
import Select from '@/components/Select';
export default function ModelInput({ value, onChange, models, id, className, placeholder, disabled, label = 'AI model' }: {value:string;onChange:(value:string)=>void;models:{id:string;name:string}[];id?:string;className?:string;placeholder?:string;disabled?:boolean;label?:string}) {
  return <Select id={id} aria-label={label} title={value || placeholder || 'Pilih model'} value={value} onChange={event=>onChange(event.target.value)} disabled={disabled} className={`${className || ''} min-w-0 max-w-[220px]`}><option value="">Model default</option>{value && !models.some(model=>model.id===value) && <option value={value}>{value}</option>}{models.map(model=><option key={model.id} value={model.id}>{model.name}</option>)}</Select>;
}
