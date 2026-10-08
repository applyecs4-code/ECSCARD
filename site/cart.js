// Shared cart (localStorage). Courses are looked up in courses-data.js
const CART_KEY = 'ecsCart';
function getCart(){ try{ return JSON.parse(localStorage.getItem(CART_KEY))||[]; }catch(e){ return []; } }
function saveCart(c){ localStorage.setItem(CART_KEY, JSON.stringify(c)); updateCartBadge(); window.dispatchEvent(new Event('cart:updated')); }
function inCart(id){ return getCart().some(i=>i.id===id); }
function addToCart(id){ const c=getCart(); if(!c.some(i=>i.id===id)){ c.push({id,qty:1}); saveCart(c);} }
function removeFromCart(id){ saveCart(getCart().filter(i=>i.id!==id)); }
function setQty(id,q){ const c=getCart(); const it=c.find(i=>i.id===id); if(it){ it.qty=Math.max(1,Math.min(50,q)); saveCart(c);} }
function clearCart(){ saveCart([]); }
function updateCartBadge(){ const n=getCart().reduce((s,i)=>s+i.qty,0); document.querySelectorAll('.cart-badge').forEach(b=>{b.textContent=n; b.style.display=n?'inline-block':'none';}); }
document.addEventListener('DOMContentLoaded', ()=>setTimeout(updateCartBadge,300));
