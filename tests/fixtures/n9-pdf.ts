// Benign two-page native-text PDF only. No actions, scripts or external resources.
export function syntheticPdf(strings:string[]){
  const streams=strings.map(s=>{
    const content="BT /F1 12 Tf 50 720 Td ("+s.replace(/[\\()]/g,"\\$&")+") Tj ET";
    return "<< /Length "+Buffer.byteLength(content)+" >>\nstream\n"+content+"\nendstream";
  });
  const objects=[
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",...streams
  ];
  let pdf="%PDF-1.4\n";
  const positions=[0];
  for(let i=0;i<objects.length;i++){
    positions.push(Buffer.byteLength(pdf));
    pdf+=String(i+1)+" 0 obj\n"+objects[i]+"\nendobj\n";
  }
  const xref=Buffer.byteLength(pdf);
  pdf+="xref\n0 "+positions.length+"\n0000000000 65535 f \n";
  for(const pos of positions.slice(1))pdf+=String(pos).padStart(10,"0")+" 00000 n \n";
  pdf+="trailer\n<< /Size "+positions.length+" /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF\n";
  return Buffer.from(pdf,"utf8");
}
