import csv
import io

data_str = """Date	Source	Device	Active_Users	Sessions	Page_Views	Engagement_Rate	Avg_Session_Duration	Event_Count
2026-05-28	(direct)	mobile	23	28	44	0.9285714286	180.070805	315
2026-05-28	(direct)	desktop	0	1	0	0	0	2
2026-05-28	google	desktop	2	2	6	1	305.1368535	23
2026-05-28	google	mobile	2	3	3	0.3333333333	20.565324	14
2026-05-27	(direct)	mobile	59	106	148	0.8962264151	220.5405195	1101
2026-05-27	(direct)	desktop	13	16	21	0.75	205.3974948	167
2026-05-27	(not set)	desktop	1	1	1	0	14.799835	6
2026-05-27	(not set)	mobile	1	1	3	0	465.252924	22
2026-05-27	google	mobile	12	20	30	0.5	65.44408915	147
2026-05-26	(direct)	mobile	47	85	118	0.8117647059	400.5236185	882
2026-05-26	(direct)	desktop	22	23	36	0.6956521739	86.66722196	234
2026-05-26	(not set)	mobile	1	1	2	0	308.211219	15
2026-05-26	chatgpt.com	mobile	1	1	1	0	0	3
2026-05-26	chatgpt.com	desktop	0	1	1	0	0	2
2026-05-26	google	mobile	8	17	28	0.7647058824	220.3701306	141
2026-05-26	google	desktop	1	1	1	0	0	3
2026-05-25	(direct)	mobile	40	72	103	0.8194444444	457.9506971	773
2026-05-25	(direct)	desktop	16	17	25	0.7058823529	250.7888679	180
2026-05-25	(not set)	desktop	1	1	1	0	20.374604	6
2026-05-25	google	mobile	11	18	41	0.7222222222	399.500392	215
2026-05-25	google	desktop	1	2	3	0.5	151.995899	8
2026-04-28	(direct)	mobile	41	69	100	0.8260869565	218.283387	689
2026-04-28	(direct)	desktop	23	24	41	0.5833333333	34.87626554	215
2026-04-28	(not set)	mobile	1	1	0	0	9.999954	4
2026-04-28	chatgpt.com	mobile	1	1	1	1	630.131172	4
2026-04-28	google	mobile	12	34	53	0.8235294118	210.0212874	361
2026-04-28	google	desktop	1	2	3	0.5	27.7949175	8"""

# Wait, let's include the full data! I will copy the text exactly from user request or read it into a Python data structure.
# Let's do this programmatically.
data_lines = [
    ("2026-05-28", "(direct)", "mobile", 23, 28, 44, 0.9285714286, 180.070805, 315),
    ("2026-05-28", "(direct)", "desktop", 0, 1, 0, 0, 0, 2),
    ("2026-05-28", "google", "desktop", 2, 2, 6, 1, 305.1368535, 23),
    ("2026-05-28", "google", "mobile", 2, 3, 3, 0.3333333333, 20.565324, 14),
    ("2026-05-27", "(direct)", "mobile", 59, 106, 148, 0.8962264151, 220.5405195, 1101),
    ("2026-05-27", "(direct)", "desktop", 13, 16, 21, 0.75, 205.3974948, 167),
    ("2026-05-27", "(not set)", "desktop", 1, 1, 1, 0, 14.799835, 6),
    ("2026-05-27", "(not set)", "mobile", 1, 1, 3, 0, 465.252924, 22),
    ("2026-05-27", "google", "mobile", 12, 20, 30, 0.5, 65.44408915, 147),
    ("2026-05-26", "(direct)", "mobile", 47, 85, 118, 0.8117647059, 400.5236185, 882),
    ("2026-05-26", "(direct)", "desktop", 22, 23, 36, 0.6956521739, 86.66722196, 234),
    ("2026-05-26", "(not set)", "mobile", 1, 1, 2, 0, 308.211219, 15),
    ("2026-05-26", "chatgpt.com", "mobile", 1, 1, 1, 0, 0, 3),
    ("2026-05-26", "chatgpt.com", "desktop", 0, 1, 1, 0, 0, 2),
    ("2026-05-26", "google", "mobile", 8, 17, 28, 0.7647058824, 220.3701306, 141),
    ("2026-05-26", "google", "desktop", 1, 1, 1, 0, 0, 3),
    ("2026-05-25", "(direct)", "mobile", 40, 72, 103, 0.8194444444, 457.9506971, 773),
    ("2026-05-25", "(direct)", "desktop", 16, 17, 25, 0.7058823529, 250.7888679, 180),
    ("2026-05-25", "(not set)", "desktop", 1, 1, 1, 0, 20.374604, 6),
    ("2026-05-25", "google", "mobile", 11, 18, 41, 0.7222222222, 399.500392, 215),
    ("2026-05-25", "google", "desktop", 1, 2, 3, 0.5, 151.995899, 8),
    ("2026-05-24", "(direct)", "mobile", 45, 66, 115, 0.8484848485, 328.8766045, 824),
    ("2026-05-24", "(direct)", "desktop", 16, 16, 90, 0.6875, 370.9745798, 386),
    ("2026-05-24", "chatgpt.com", "mobile", 1, 1, 2, 1, 69.386558, 10),
    ("2026-05-24", "google", "mobile", 10, 20, 33, 0.65, 1078.48251, 210),
    ("2026-05-24", "google", "desktop", 2, 3, 4, 0.6666666667, 142.211388, 23),
    ("2026-05-23", "(direct)", "mobile", 15, 24, 38, 0.5833333333, 77.42667437, 173),
    ("2026-05-23", "(direct)", "desktop", 2, 2, 2, 0, 0.041968, 8),
    ("2026-05-23", "google", "mobile", 5, 7, 11, 0.5714285714, 53.61396743, 48),
    ("2026-05-23", "google", "desktop", 1, 1, 3, 1, 216.183224, 10),
    ("2026-05-23", "restaurantguru", "desktop", 1, 1, 1, 0, 0, 3),
    ("2026-05-22", "(direct)", "mobile", 29, 44, 57, 0.5909090909, 164.6729756, 269),
    ("2026-05-22", "(direct)", "desktop", 6, 7, 15, 0.5714285714, 719.026066, 124),
    ("2026-05-22", "chatgpt.com", "desktop", 0, 2, 0, 0, 0, 4),
    ("2026-05-22", "google", "mobile", 6, 11, 18, 0.7272727273, 143.7015137, 80),
    ("2026-05-22", "google", "desktop", 2, 2, 5, 0.5, 73.451103, 14),
    ("2026-05-21", "(direct)", "mobile", 47, 77, 126, 0.7922077922, 245.1251823, 826),
    ("2026-05-21", "(direct)", "desktop", 14, 21, 28, 0.7142857143, 240.2423016, 219),
    ("2026-05-21", "(not set)", "desktop", 1, 1, 12, 0, 266.284151, 52),
    ("2026-05-21", "chatgpt.com", "desktop", 0, 1, 1, 0, 0, 2),
    ("2026-05-21", "google", "mobile", 7, 21, 51, 0.8095238095, 300.984822, 300),
    ("2026-05-21", "google", "desktop", 3, 3, 7, 1, 670.872426, 34),
    ("2026-05-20", "(direct)", "mobile", 45, 72, 107, 0.8194444444, 244.6786977, 714),
    ("2026-05-20", "(direct)", "desktop", 17, 19, 27, 0.6315789474, 159.7168977, 200),
    ("2026-05-20", "(not set)", "mobile", 1, 1, 1, 0, 25.920598, 7),
    ("2026-05-20", "chatgpt.com", "desktop", 1, 1, 1, 0, 4.995594, 3),
    ("2026-05-20", "chatgpt.com", "mobile", 1, 1, 2, 1, 9.690121, 6),
    ("2026-05-20", "google", "mobile", 9, 16, 30, 0.6875, 392.3841798, 145),
    ("2026-05-19", "(direct)", "mobile", 48, 89, 132, 0.808988764, 248.1460782, 918),
    ("2026-05-19", "(direct)", "desktop", 12, 14, 20, 0.7142857143, 186.6980854, 159),
    ("2026-05-19", "chatgpt.com", "desktop", 1, 1, 1, 1, 263.499826, 4),
    ("2026-05-19", "google", "mobile", 13, 20, 53, 0.95, 417.3576671, 306),
    ("2026-05-18", "(direct)", "mobile", 48, 69, 109, 0.8115942029, 226.6375347, 718),
    ("2026-05-18", "(direct)", "desktop", 20, 27, 37, 0.6666666667, 328.8091597, 277),
    ("2026-05-18", "(not set)", "desktop", 1, 1, 1, 0, 67.917747, 7),
    ("2026-05-18", "google", "mobile", 11, 23, 44, 0.6086956522, 188.7594295, 219),
    ("2026-05-18", "google", "desktop", 3, 4, 7, 1, 206.5679143, 49),
    ("2026-05-17", "(direct)", "mobile", 34, 51, 70, 0.8823529412, 266.1151139, 539),
    ("2026-05-17", "(direct)", "desktop", 12, 13, 17, 0.6923076923, 67.43920077, 126),
    ("2026-05-17", "google", "mobile", 9, 12, 30, 0.8333333333, 317.8331415, 198),
    ("2026-05-17", "google", "desktop", 2, 2, 2, 0.5, 269.2952565, 17),
    ("2026-05-16", "(direct)", "mobile", 16, 26, 35, 0.6923076923, 102.672326, 206),
    ("2026-05-16", "(direct)", "desktop", 4, 4, 4, 0.5, 371.5618153, 27),
    ("2026-05-16", "google", "mobile", 6, 15, 27, 0.7333333333, 177.4540043, 126),
    ("2026-05-16", "google", "desktop", 1, 1, 1, 1, 1400.674764, 4),
    ("2026-05-15", "(direct)", "mobile", 46, 72, 97, 0.8194444444, 197.6555621, 731),
    ("2026-05-15", "(direct)", "desktop", 14, 15, 20, 0.2, 213.9424763, 110),
    ("2026-05-15", "bing", "desktop", 1, 1, 4, 1, 719.480669, 39),
    ("2026-05-15", "google", "mobile", 7, 10, 18, 0.9, 247.3118066, 97),
    ("2026-05-15", "google", "desktop", 1, 2, 3, 1, 881.411067, 24),
    ("2026-05-15", "shriharioze.github.io", "desktop", 1, 1, 5, 1, 40.745491, 15),
    ("2026-05-14", "(direct)", "mobile", 36, 61, 81, 0.9016393443, 207.3247244, 664),
    ("2026-05-14", "(direct)", "desktop", 14, 18, 23, 0.7222222222, 265.4500967, 185),
    ("2026-05-14", "google", "mobile", 8, 21, 42, 0.8095238095, 347.5439028, 244),
    ("2026-05-14", "google", "desktop", 2, 5, 6, 0.8, 39.3741544, 38),
    ("2026-05-13", "(direct)", "mobile", 46, 76, 114, 0.8815789474, 233.0259804, 801),
    ("2026-05-13", "(direct)", "desktop", 12, 19, 34, 0.8947368421, 496.4970358, 311),
    ("2026-05-13", "google", "mobile", 11, 23, 54, 0.6956521739, 314.8625789, 266),
    ("2026-05-13", "google", "desktop", 2, 2, 5, 1, 614.1859895, 26),
    ("2026-05-13", "shriharioze.github.io", "desktop", 2, 3, 9, 1, 29.17537567, 28),
    ("2026-05-12", "(direct)", "mobile", 43, 73, 98, 0.8082191781, 188.9628189, 644),
    ("2026-05-12", "(direct)", "desktop", 10, 12, 14, 0.75, 289.0208868, 113),
    ("2026-05-12", "(not set)", "desktop", 1, 1, 1, 0, 7.598088, 5),
    ("2026-05-12", "google", "mobile", 7, 11, 19, 0.9090909091, 407.1227865, 122),
    ("2026-05-12", "google", "desktop", 1, 1, 4, 1, 498.980711, 18),
    ("2026-05-11", "(direct)", "mobile", 44, 78, 117, 0.7948717949, 258.7975621, 833),
    ("2026-05-11", "(direct)", "desktop", 18, 20, 32, 0.8, 422.7916755, 241),
    ("2026-05-11", "(not set)", "desktop", 1, 1, 0, 0, 0, 1),
    ("2026-05-11", "(not set)", "mobile", 1, 1, 2, 0, 936.546583, 27),
    ("2026-05-11", "chatgpt.com", "mobile", 1, 1, 1, 0, 0, 3),
    ("2026-05-11", "google", "mobile", 7, 15, 26, 1, 335.0507649, 172),
    ("2026-05-11", "google", "desktop", 1, 1, 1, 1, 22.965094, 8),
    ("2026-05-11", "l.instagram.com", "mobile", 1, 1, 3, 1, 16.444895, 8),
    ("2026-05-10", "(direct)", "mobile", 45, 67, 100, 0.7014925373, 212.1576207, 605),
    ("2026-05-10", "(direct)", "desktop", 16, 17, 30, 0.8235294118, 348.8335836, 230),
    ("2026-05-10", "google", "mobile", 8, 18, 29, 0.7222222222, 174.4420528, 147),
    ("2026-05-10", "google", "desktop", 1, 1, 1, 1, 56.902337, 4),
    ("2026-05-09", "(direct)", "mobile", 21, 27, 41, 0.7777777778, 178.3311114, 255),
    ("2026-05-09", "(direct)", "desktop", 2, 2, 2, 0, 5.3147235, 8),
    ("2026-05-09", "google", "mobile", 4, 8, 10, 0.375, 119.4130972, 39),
    ("2026-05-09", "google", "desktop", 1, 1, 3, 1, 396.368884, 10),
    ("2026-05-08", "(direct)", "mobile", 36, 65, 117, 0.7692307692, 314.6109359, 713),
    ("2026-05-08", "(direct)", "desktop", 5, 5, 5, 0.2, 72.2883528, 29),
    ("2026-05-08", "(not set)", "mobile", 0, 1, 0, 0, 0, 1),
    ("2026-05-08", "google", "mobile", 7, 19, 35, 0.8947368421, 394.1695921, 209),
    ("2026-05-08", "google", "desktop", 2, 2, 2, 0.5, 119.2235965, 13),
    ("2026-05-07", "(direct)", "mobile", 45, 76, 96, 0.7236842105, 206.4341878, 647),
    ("2026-05-07", "(direct)", "desktop", 14, 15, 17, 0.8, 198.7544831, 137),
    ("2026-05-07", "google", "mobile", 10, 19, 36, 0.7368421053, 487.0773169, 201),
    ("2026-05-07", "google", "desktop", 3, 5, 8, 1, 784.3291424, 55),
    ("2026-05-06", "(direct)", "mobile", 38, 68, 110, 0.7794117647, 238.3894887, 627),
    ("2026-05-06", "(direct)", "desktop", 15, 17, 38, 0.7647058824, 372.2803029, 262),
    ("2026-05-06", "(not set)", "mobile", 1, 1, 6, 0, 1652.447774, 29),
    ("2026-05-06", "google", "mobile", 13, 25, 49, 0.76, 209.7630137, 227),
    ("2026-05-06", "google", "desktop", 4, 4, 8, 1, 599.3681955, 47),
    ("2026-05-05", "(direct)", "mobile", 40, 71, 100, 0.7464788732, 309.7757521, 663),
    ("2026-05-05", "(direct)", "desktop", 10, 12, 22, 0.8333333333, 293.7288977, 182),
    ("2026-05-05", "google", "mobile", 9, 21, 31, 0.7619047619, 337.493629, 196),
    ("2026-05-05", "google", "desktop", 3, 4, 7, 0.75, 197.128461, 37),
    ("2026-05-04", "(direct)", "mobile", 36, 63, 101, 0.8253968254, 303.4946267, 641),
    ("2026-05-04", "(direct)", "desktop", 17, 20, 35, 0.75, 155.5903121, 237),
    ("2026-05-04", "google", "mobile", 10, 24, 38, 0.6666666667, 210.3587016, 212),
    ("2026-05-04", "google", "desktop", 4, 4, 8, 0.75, 719.366375, 41),
    ("2026-05-03", "(direct)", "mobile", 29, 43, 66, 0.8139534884, 264.3792324, 455),
    ("2026-05-03", "(direct)", "desktop", 11, 11, 20, 0.3636363636, 177.6471304, 107),
    ("2026-05-03", "google", "mobile", 7, 11, 18, 1, 561.3354682, 140),
    ("2026-05-03", "google", "desktop", 1, 1, 3, 1, 475.73348, 15),
    ("2026-05-02", "(direct)", "mobile", 10, 17, 21, 0.8235294118, 88.77342582, 134),
    ("2026-05-02", "(direct)", "desktop", 4, 4, 7, 0.5, 13.50461625, 24),
    ("2026-05-02", "(not set)", "mobile", 1, 1, 1, 0, 850.499853, 12),
    ("2026-05-02", "gemini.google.com", "desktop", 1, 1, 1, 1, 255.278967, 4),
    ("2026-05-02", "google", "mobile", 5, 7, 14, 0.7142857143, 54.04774957, 59),
    ("2026-05-01", "(direct)", "mobile", 27, 42, 66, 0.8095238095, 338.5237952, 487),
    ("2026-05-01", "(direct)", "desktop", 22, 23, 34, 0.4347826087, 103.2283723, 157),
    ("2026-05-01", "google", "mobile", 8, 12, 20, 0.6666666667, 149.5271164, 111),
    ("2026-05-01", "google", "desktop", 1, 2, 6, 1, 505.51714, 25),
    ("2026-04-30", "(direct)", "mobile", 26, 46, 68, 0.8043478261, 230.3284879, 488),
    ("2026-04-30", "(direct)", "desktop", 3, 4, 3, 0.25, 12.89844575, 19),
    ("2026-04-30", "(not set)", "mobile", 1, 1, 1, 0, 1280.775875, 6),
    ("2026-04-30", "google", "mobile", 10, 16, 31, 0.8125, 98.29771144, 167),
    ("2026-04-30", "google", "desktop", 1, 2, 4, 1, 35.7520735, 17),
    ("2026-04-29", "(direct)", "mobile", 39, 60, 80, 0.8833333333, 171.1098236, 622),
    ("2026-04-29", "(direct)", "desktop", 14, 14, 19, 0.5714285714, 153.1062965, 128),
    ("2026-04-29", "google", "mobile", 6, 16, 28, 0.875, 189.7788776, 155),
    ("2026-04-29", "google", "desktop", 2, 2, 5, 0.5, 134.707291, 26),
    ("2026-04-28", "(direct)", "mobile", 41, 69, 100, 0.8260869565, 218.283387, 689),
    ("2026-04-28", "(direct)", "desktop", 23, 24, 41, 0.5833333333, 34.87626554, 215),
    ("2026-04-28", "(not set)", "mobile", 1, 1, 0, 0, 9.999954, 4),
    ("2026-04-28", "chatgpt.com", "mobile", 1, 1, 1, 1, 630.131172, 4),
    ("2026-04-28", "google", "mobile", 12, 34, 53, 0.8235294118, 210.0212874, 361),
    ("2026-04-28", "google", "desktop", 1, 2, 3, 0.5, 27.7949175, 8)
]

# Compute aggregates
total_sessions = sum(row[4] for row in data_lines)
total_page_views = sum(row[5] for row in data_lines)
total_active_users = sum(row[3] for row in data_lines)
total_event_count = sum(row[8] for row in data_lines)

# Weighted engagement rate
total_engaged_sessions = sum(row[4] * row[6] for row in data_lines)
avg_engagement_rate = total_engaged_sessions / total_sessions if total_sessions else 0

# Weighted session duration
total_session_duration = sum(row[4] * row[7] for row in data_lines)
avg_session_duration = total_session_duration / total_sessions if total_sessions else 0

# Breakdowns
source_breakdown = {}
device_breakdown = {}

for row in data_lines:
    date, src, dev, au, sess, pv, er, dur, ec = row
    
    # Source
    if src not in source_breakdown:
        source_breakdown[src] = {"sessions": 0, "page_views": 0, "engaged_sessions": 0, "duration": 0, "active_users": 0}
    source_breakdown[src]["sessions"] += sess
    source_breakdown[src]["page_views"] += pv
    source_breakdown[src]["engaged_sessions"] += sess * er
    source_breakdown[src]["duration"] += sess * dur
    source_breakdown[src]["active_users"] += au

    # Device
    if dev not in device_breakdown:
        device_breakdown[dev] = {"sessions": 0, "page_views": 0, "engaged_sessions": 0, "duration": 0, "active_users": 0}
    device_breakdown[dev]["sessions"] += sess
    device_breakdown[dev]["page_views"] += pv
    device_breakdown[dev]["engaged_sessions"] += sess * er
    device_breakdown[dev]["duration"] += sess * dur
    device_breakdown[dev]["active_users"] += au

print("--- OVERALL METRICS ---")
print(f"Total Active Users (Sum of daily): {total_active_users}")
print(f"Total Sessions: {total_sessions}")
print(f"Total Page Views: {total_page_views}")
print(f"Total Events: {total_event_count}")
print(f"Average Engagement Rate: {avg_engagement_rate:.2%}")
print(f"Average Session Duration: {avg_session_duration:.2f}s")
print()

print("--- SOURCE BREAKDOWN ---")
for src, vals in source_breakdown.items():
    s_er = vals["engaged_sessions"] / vals["sessions"] if vals["sessions"] else 0
    s_dur = vals["duration"] / vals["sessions"] if vals["sessions"] else 0
    print(f"Source: {src}")
    print(f"  Sessions: {vals['sessions']} ({vals['sessions']/total_sessions:.2%})")
    print(f"  Page Views: {vals['page_views']}")
    print(f"  Active Users: {vals['active_users']}")
    print(f"  Engagement Rate: {s_er:.2%}")
    print(f"  Avg Duration: {s_dur:.2f}s")

print()
print("--- DEVICE BREAKDOWN ---")
for dev, vals in device_breakdown.items():
    d_er = vals["engaged_sessions"] / vals["sessions"] if vals["sessions"] else 0
    d_dur = vals["duration"] / vals["sessions"] if vals["sessions"] else 0
    print(f"Device: {dev}")
    print(f"  Sessions: {vals['sessions']} ({vals['sessions']/total_sessions:.2%})")
    print(f"  Page Views: {vals['page_views']}")
    print(f"  Active Users: {vals['active_users']}")
    print(f"  Engagement Rate: {d_er:.2%}")
    print(f"  Avg Duration: {d_dur:.2f}s")
