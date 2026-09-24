function confirmDelete(){return confirm('Delete this item? This action cannot be undone.');}
document.addEventListener('DOMContentLoaded',()=>{
  const file=document.getElementById('fileInput'), name=document.getElementById('fileName');
  if(file&&name) file.addEventListener('change',()=>{name.textContent=file.files?.[0]?.name||'No file selected';});
  const pass=document.getElementById('password'), meter=document.getElementById('passwordMeter');
  if(pass&&meter) pass.addEventListener('input',()=>{
    const v=pass.value; let score=0;
    if(v.length>=6)score++; if(v.length>=10)score++; if(/[A-Z]/.test(v)&&/[a-z]/.test(v))score++; if(/\d/.test(v)&&/[^A-Za-z0-9]/.test(v))score++;
    meter.style.width=(score*25)+'%';
  });
  setTimeout(()=>document.querySelectorAll('[data-flash]').forEach(x=>x.remove()),5000);
});
