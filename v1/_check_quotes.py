c = open(r'c:\Users\zigmo\Desktop\app\CUTTHEFLOW0707\js\app.js', encoding='utf-8').read()

# Count quotes
sq = c.count("'")
dq = c.count('"')
bt = c.count('`')
print(f"Simple quotes: {sq} ({'OK' if sq%2==0 else 'IMPAIR!'})")
print(f"Double quotes: {dq} ({'OK' if dq%2==0 else 'IMPAIR!'})")
print(f"Backticks: {bt} ({'OK' if bt%2==0 else 'IMPAIR!'})")
