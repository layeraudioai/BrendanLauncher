import './style.css';

const greeting = document.querySelector<HTMLHeadingElement>('#greeting');
const button = document.querySelector<HTMLButtonElement>('#count');
if (!greeting || !button) throw new Error('Example app DOM is incomplete');
greeting.textContent = 'Hello from TypeScript';
let count = 0;
button.addEventListener('click', () => {
  count += 1;
  button.textContent = `Clicked ${count} time${count === 1 ? '' : 's'}`;
});
