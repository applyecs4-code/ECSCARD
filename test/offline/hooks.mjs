const map = { '@supabase/supabase-js': './sb.mjs', bcryptjs: './bcrypt.mjs', nodemailer: './mailer.mjs' };
export async function resolve(spec, ctx, next) {
  if (map[spec]) return { url: new URL(map[spec], import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
