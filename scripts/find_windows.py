import Quartz

windows = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionAll, Quartz.kCGNullWindowID)
found = False
for w in windows:
    owner = str(w.get('kCGWindowOwnerName', ''))
    wid = w.get('kCGWindowNumber', 0)
    name = str(w.get('kCGWindowName', ''))
    bounds = w.get('kCGWindowBounds', {})
    if 'petak' in owner.lower() or 'petak' in name.lower():
        print(f"wid={wid} owner={owner} name={name} bounds={bounds}")
        found = True

if not found:
    print("No Petak window found. Listing active windows:")
    for w in windows[:15]:
        owner = str(w.get('kCGWindowOwnerName', ''))
        wid = w.get('kCGWindowNumber', 0)
        name = str(w.get('kCGWindowName', ''))
        print(f"wid={wid} owner={owner} name={name}")
