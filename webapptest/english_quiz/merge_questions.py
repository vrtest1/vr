import json

def merge_json(file1, file2, output_file):
    with open(file1, 'r') as f1:
        data1 = json.load(f1)
    with open(file2, 'r') as f2:
        data2 = json.load(f2)
    
    merged_data = data1 + data2
    
    with open(output_file, 'w') as out:
        json.dump(merged_data, out, ensure_ascii=False, indent=2)

merge_json('questions.json', 'questions_part2.json', 'questions.json')
