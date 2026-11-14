/**
 * How scaffold names what it finds: ids that stay unique and stable, and the
 * small amount of inflection that turns a table name into an aggregate.
 */

export function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s.]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/**
 * Keeps ids unique without renaming what came before, so scanning the same
 * tree twice produces the same model.
 */
export class IdSet {
  private taken = new Set<string>();

  /** `preferred` first, then each fallback, then a numeric suffix. */
  claim(preferred: string, ...fallbacks: string[]): string {
    for (const candidate of [preferred, ...fallbacks]) {
      const id = kebab(candidate);
      if (id && !this.taken.has(id)) {
        this.taken.add(id);
        return id;
      }
    }
    const base = kebab(preferred) || 'node';
    for (let n = 2; ; n++) {
      const id = `${base}-${n}`;
      if (!this.taken.has(id)) {
        this.taken.add(id);
        return id;
      }
    }
  }

  has(id: string): boolean {
    return this.taken.has(id);
  }
}

/**
 * Table names are plural and aggregate names are not. Naive, and wrong often
 * enough that the scaffold says so rather than presenting it as a fact.
 */
export function singularise(name: string): string {
  // address, status, analysis — an `s` that was never a plural.
  if (/(ss|us|is)$/.test(name)) return name;
  if (/ies$/.test(name)) return name.replace(/ies$/, 'y');
  if (/s$/.test(name)) return name.replace(/s$/, '');
  return name;
}

/**
 * The inverse, for naming a projection after the rows it holds.
 *
 * An aggregate is one encounter and a read-model is the list of them, so the
 * plural keeps the two apart in one namespace without a `-view` suffix that
 * would collide with a screen named after the same thing.
 */
export function pluralise(name: string): string {
  if (/(s|x|z|ch|sh)$/.test(name)) return `${name}es`;
  if (/[^aeiou]y$/.test(name)) return name.replace(/y$/, 'ies');
  return `${name}s`;
}

export function titleise(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map(w => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}
