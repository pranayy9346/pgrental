// The application writes one SQL dialect that both SQLite and PostgreSQL understand, using two placeholder styles:
//   ?       positional   db.get('SELECT * FROM users WHERE id = ?', [id])
//   @name   named        db.run('UPDATE users SET name = @name WHERE id = @id', { name, id })
// SQLite accepts both natively. PostgreSQL wants $1, $2, ... so this converts them (text in quotes is left alone).
export function toPg(sql, params = []) {
  const named = params !== null && typeof params === 'object' && !Array.isArray(params);
  const values = [];
  const seen = new Map();
  let out = '';
  let positional = 0;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];

    if (c === "'") {
      // copy a quoted string literal unchanged ('' is an escaped quote)
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      out += sql.slice(i, j + 1);
      i = j;
    } else if (c === '?') {
      if (named) throw new Error('SQL uses ? placeholders but named parameters were given');
      values.push(params[positional++]);
      out += `$${values.length}`;
    } else if (c === '@' && /[A-Za-z_]/.test(sql[i + 1] ?? '')) {
      let j = i + 1;
      while (/[A-Za-z0-9_]/.test(sql[j] ?? '')) j++;
      const name = sql.slice(i + 1, j);
      if (!named) throw new Error(`SQL uses @${name} but no named parameters were given`);
      if (!seen.has(name)) {
        if (!(name in params)) throw new Error(`Missing named parameter @${name}`);
        values.push(params[name]);
        seen.set(name, values.length);
      }
      out += `$${seen.get(name)}`;
      i = j - 1;
    } else {
      out += c;
    }
  }

  if (!named && positional !== (params?.length ?? 0)) {
    throw new Error(`SQL has ${positional} placeholders but ${params?.length ?? 0} values were given`);
  }
  return { text: out, values: values.map((v) => (v === undefined ? null : v)) };
}
