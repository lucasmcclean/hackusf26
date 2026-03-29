import uuid
import random
import argparse

CRISIS_MESSAGES = [
    "My house is flooding and I can't get out!",
    "Strong winds blew the roof off my shed, please help!",
    "Roads are blocked by debris and I can't leave.",
    "Water level rising fast in my area, need evacuation!",
    "Trees fell on power lines, no electricity.",
    "Trapped in my car due to flood water.",
    "Basement is completely under water.",
    "My neighbor needs help, they're stuck in their house.",
    "Windstorm damaged my windows, it's dangerous inside.",
    "Flooded streets, can't reach the main road."
]

def generate_users_sql_and_messages(num_users, lon_min, lon_max, lat_min, lat_max, table_name="users"):
    sql_lines = [f"INSERT INTO {table_name} (id, priority, location_geom) VALUES"]
    values = []
    user_ids = []

    for _ in range(num_users):
        user_id = str(uuid.uuid4())
        user_ids.append(user_id)
        lon = round(random.uniform(lon_min, lon_max), 6)
        lat = round(random.uniform(lat_min, lat_max), 6)
        values.append(f"('{user_id}', 0, ST_SetSRID(ST_MakePoint({lon}, {lat}), 4326)::geography)")

    sql_lines.append(",\n".join(values) + ";")
    sql_output = "\n".join(sql_lines)

    python_lines = ["# Example user messages during flood and strong wind scenario",
                    "from users.user_message import add_user_message\n"]

    for user_id in user_ids:
        message = random.choice(CRISIS_MESSAGES)
        python_lines.append(f"add_user_message('{message}', '{user_id}')")

    python_output = "\n".join(python_lines)

    return sql_output, python_output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate random users SQL and Python messages")
    parser.add_argument("--num_users", type=int, default=50, help="Number of users to generate")
    parser.add_argument("--lon_min", type=float, required=True, help="Minimum longitude")
    parser.add_argument("--lon_max", type=float, required=True, help="Maximum longitude")
    parser.add_argument("--lat_min", type=float, required=True, help="Minimum latitude")
    parser.add_argument("--lat_max", type=float, required=True, help="Maximum latitude")
    parser.add_argument("--table_name", type=str, default="users", help="Database table name")

    args = parser.parse_args()

    sql_output, python_output = generate_users_sql_and_messages(
        args.num_users, args.lon_min, args.lon_max, args.lat_min, args.lat_max, args.table_name
    )

    # Output results
    print("-- SQL INSERT statements for users\n")
    print(sql_output)
    print("\n\n# Python code to simulate user messages\n")
    print(python_output)
