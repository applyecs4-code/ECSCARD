export const sent = (globalThis.__sent ??= []);
export default { createTransport: () => ({ sendMail: async (m) => { if (globalThis.__mailFail) throw new Error('smtp down'); sent.push(m); } }) };
