
import json
import os

def load_json(filename):
    if not os.path.exists(filename):
        return []
    with open(filename, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_json(filename, data):
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def main():
    main_file = 'questions.json'
    new_files = ['new_batch_1.json', 'new_batch_2.json']
    
    # Load existing questions
    existing_questions = load_json(main_file)
    print(f"Original count: {len(existing_questions)}")
    
    # Use a dictionary to track idioms (normalized to lowercase for comparison)
    idiom_map = {q['idiom'].lower(): q for q in existing_questions}
    
    added_count = 0
    
    for nf in new_files:
        batch = load_json(nf)
        print(f"Loading {nf}: found {len(batch)} questions")
        
        for q in batch:
            key = q['idiom'].lower()
            if key not in idiom_map:
                idiom_map[key] = q
                existing_questions.append(q)
                added_count += 1
            else:
                # Optional: Update existing if needed? For now, skip duplicates as planned
                pass

    print(f"Added {added_count} new unique questions.")
    print(f"New total count: {len(existing_questions)}")
    
    save_json(main_file, existing_questions)
    
    # Cleanup
    for nf in new_files:
        if os.path.exists(nf):
            os.remove(nf)
            print(f"Removed {nf}")

if __name__ == "__main__":
    main()
