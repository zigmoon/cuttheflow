import re
c = open(r'c:\Users\zigmo\Desktop\app\CUTTHEFLOW0707\js\app.js', encoding='utf-8').read()
# Remove comments and string literals
c = re.sub(r'//.*$', '', c, flags=re.MULTILINE)
c = re.sub(r'/\*.*?\*/', '', c, flags=re.DOTALL)
c = re.sub(r'"(?:[^"\\]|\\.)*"', '', c)
c = re.sub(r"'(?:[^'\\]|\\.)*'", '', c)
c = re.sub(r'`(?:[^`\\]|\\.)*`', '', c)
o = c.count('(')
f = c.count(')')
print(f'Parens: ({o}, ){f} Diff={o-f}')

if o != f:
    lines = c.split('\n')
    bal = 0
    for i, line in enumerate(lines, 1):
        for ch in line:
            if ch == '(': bal += 1
            elif ch == ')': bal -= 1
        # Show lines where balance changes significantly
        # Actually find first negative balance:
    # Reset and find
    bal = 0
    for i, line in enumerate(lines, 1):
        for ch in line:
            if ch == '(': bal += 1
            elif ch == ')': bal -= 1
        if bal < 0:
            print(f'Ligne {i} (bal={bal}): {line.strip()[:150]}')
            break
    else:
        # If never went negative but still unbalanced, show last 50 lines where balance changed
        print("Jamais negatif mais desequilibre. Dernieres lignes avec '(' ou ')' :")
        count = 0
        for i in range(len(lines)-1, -1, -1):
            if '(' in lines[i] or ')' in lines[i]:
                bal2 = 0
                for j in range(i):
                    for ch in lines[j]:
                        if ch == '(': bal2 += 1
                        elif ch == ')': bal2 -= 1
                print(f'  L{i+1} (cumul={bal2}): {lines[i].strip()[:150]}')
                count += 1
                if count >= 20:
                    break
