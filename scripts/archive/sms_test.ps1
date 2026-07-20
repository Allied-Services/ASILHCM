Add-Type -AssemblyName System.Web

# Test via Render backend (whitelisted IP) using a fresh JWT
$JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjExMDg3MzY0MTI0MjgyNDE4OTg4NCIsImVtYWlsIjoic2hlemFkLm11bXRhekBhc2lsLmNvbS5wayIsIm5hbWUiOiJTaGV6YWQgUyBNdW10YXoiLCJhdmF0YXIiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NJSTZTMWx4RWxISklIUWVXdGQ0d1h0ODFVb0RZdWFKQUR1cm12cGFEdnpLXzZTSWc9czk2LWMiLCJyb2xlIjoic3RhZmYiLCJpYXQiOjE3NzQyNTkyNjQsImV4cCI6MTc3NDI4ODA2NH0.xjN_-SZnWjg0uvOKp265josncEv4Na0_G4TdwDlQesQ"
$BACKEND = "https://asilhcm.onrender.com"

Write-Host "=== Sending SMS via Render backend (mask: ALLIED SERV) ==="
$body = '{"to":"03008275688","message":"ASIL HCM: SMS now working! ALLIED SERV mask confirmed. - Systems Test"}'
try {
    $r = Invoke-RestMethod -Uri "$BACKEND/api/sms/send" `
         -Method POST `
         -Headers @{ "Authorization" = "Bearer $JWT"; "Content-Type" = "application/json" } `
         -Body $body
    Write-Host "Result: $($r | ConvertTo-Json -Compress)"
    if ($r.response -match "^\d") {
        Write-Host "SUCCESS! Jazz returned a message ID: $($r.response)"
    } else {
        Write-Host "Jazz says: $($r.response)"
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}
