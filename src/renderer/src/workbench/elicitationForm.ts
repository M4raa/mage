import type { ElicitationFormSchema } from '@shared/elicitation';

// Estado de un formulario de elicitation: el texto crudo de cada campo (los booleanos, 'true'/'false').
// Lógica pura: el componente solo pinta y llama aquí.
export type FormValues = Readonly<Record<string, string>>;
export type FormContent = Record<string, string | number | boolean>;

type Field = ElicitationFormSchema['properties'][string];

export function initialValues(schema: ElicitationFormSchema): FormValues {
  const values: Record<string, string> = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    if (field.type === 'boolean') values[name] = String(field.default ?? false);
    else values[name] = field.default === undefined ? (field.type === 'string' ? (field.enum?.[0] ?? '') : '') : String(field.default);
  }
  return values;
}

function fieldError(field: Field, raw: string, required: boolean): string | null {
  if (field.type === 'boolean') return null;
  if (raw.trim().length === 0) return required ? 'Obligatorio' : null;
  if (field.type === 'string') {
    if (field.minLength !== undefined && raw.length < field.minLength) return `Mínimo ${field.minLength} caracteres`;
    if (field.maxLength !== undefined && raw.length > field.maxLength) return `Máximo ${field.maxLength} caracteres`;
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return 'Número no válido';
  if (field.type === 'integer' && !Number.isInteger(value)) return 'Debe ser un entero';
  if (field.minimum !== undefined && value < field.minimum) return `Mínimo ${field.minimum}`;
  if (field.maximum !== undefined && value > field.maximum) return `Máximo ${field.maximum}`;
  return null;
}

// Errores por campo; vacío = se puede aceptar.
export function formErrors(schema: ElicitationFormSchema, values: FormValues): Readonly<Record<string, string>> {
  const required = new Set(schema.required ?? []);
  const errors: Record<string, string> = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    const error = fieldError(field, values[name] ?? '', required.has(name));
    if (error !== null) errors[name] = error;
  }
  return errors;
}

// Contenido de la respuesta `accept`: los campos opcionales vacíos se omiten.
export function toContent(schema: ElicitationFormSchema, values: FormValues): FormContent {
  const content: FormContent = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    const raw = values[name] ?? '';
    if (field.type === 'boolean') content[name] = raw === 'true';
    else if (raw.trim().length === 0) continue;
    else content[name] = field.type === 'string' ? raw : Number(raw);
  }
  return content;
}
