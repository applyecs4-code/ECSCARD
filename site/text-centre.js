(function () {
  const input = document.getElementById('postcodeInput');
  const btn   = document.getElementById('postcodeBtn');

  let hits = [];
  let idx  = -1;

  function unmarkAll() {
    document.querySelectorAll('mark.postcode-hit').forEach(m => {
      const parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
    hits = [];
    idx = -1;
  }

  function highlight(term) {
    if (!term) { unmarkAll(); return; }
    unmarkAll();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          const tag = p.closest('script,style,noscript,textarea,input,select,option,button,code,pre,svg,canvas,iframe');
          if (tag) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const t = term.toLowerCase();
    let node;
    while (node = walker.nextNode()) {
      const text = node.nodeValue;
      const lower = text.toLowerCase();
      let start = 0, found = false;
      const frag = document.createDocumentFragment();

      while (true) {
        const i = lower.indexOf(t, start);
        if (i === -1) break;
        found = true;
        frag.appendChild(document.createTextNode(text.slice(start, i)));
        const mark = document.createElement('mark');
        mark.className = 'postcode-hit';
        mark.textContent = text.slice(i, i + term.length);
        frag.appendChild(mark);
        start = i + term.length;
      }
      if (found) {
        frag.appendChild(document.createTextNode(text.slice(start)));
        node.parentNode.replaceChild(frag, node);
      }
    }

    hits = Array.from(document.querySelectorAll('mark.postcode-hit'));
    if (hits.length) {
      idx = 0;
      hits[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      idx = -1;
      alert("No centre found with that postcode!");
    }
  }

  btn.addEventListener('click', () => highlight(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') highlight(input.value.trim());
  });
})();
