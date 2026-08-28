Output assets/demo.gif
Set Width 1100
Set Height 560
Set FontSize 15
Set Padding 18
Set Theme "Dracula"

Type "node dist/src/cli.js init --task 'Build the login page' --output /tmp/negplan-demo.md"
Enter
Sleep 800ms

Type "cat /tmp/negplan-demo.md"
Enter
Sleep 1200ms

Type "node dist/src/cli.js validate -f /tmp/negplan-demo.md"
Enter
Sleep 1000ms

Type "rm -f /tmp/negplan-demo.md"
Enter
Sleep 400ms
