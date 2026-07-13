import re

with open(r'c:\Users\naifb\Desktop\eyelevel intern\project\flowzen\apps\api\src\routes\crm.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix error 1 (POST route)
target1 = "          body: [stage === 'CHURNED' && reasonLabel ? `Reason: ${reasonLabel}` : null, notes || null].filter(Boolean).join(' — ') || null,\n          metadata: { from: previousStage, to: stage },"
replacement1 = "          metadata: { from: previousStage, to: stage, body: [stage === 'CHURNED' && reasonLabel ? `Reason: ${reasonLabel}` : null, notes || null].filter(Boolean).join(' — ') || null },"
if target1 in content:
    content = content.replace(target1, replacement1)
else:
    print("Could not find target1")

# Fix error 2 (PATCH route fields undefined)
target2 = "    if (fields && typeof fields === 'object' && Object.keys(fields).length > 0) {"
replacement2 = "    const fields = req.body.fields;\n    if (fields && typeof fields === 'object' && Object.keys(fields).length > 0) {"
if target2 in content:
    content = content.replace(target2, replacement2)
else:
    print("Could not find target2")

with open(r'c:\Users\naifb\Desktop\eyelevel intern\project\flowzen\apps\api\src\routes\crm.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done fixing TS errors")
