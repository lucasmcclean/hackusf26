from datetime import datetime

from messages.user_message import add_user_message, query_user_messages

add_user_message("Help me", "abcd", -44.32418, 32.65964, datetime.now())
add_user_message("I am in need of assistance", "abc", -45.32418, 32.95964, datetime.now())
add_user_message("What is happening", "ab", -44.12418, 33.75964, datetime.now())

print(query_user_messages("Summarize the situation"))
